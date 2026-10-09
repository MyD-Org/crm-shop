import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { getPedidoParaPago, motivoNoCobrable, registrarCuentaRechazada } from "@/lib/pedidos";
import { procesadorDeMedio } from "@/lib/medios-pago";
import { permitir } from "@/lib/rate-limit";
import { cuentaParaCobrar } from "@/lib/pagos/cuentas-sucursales";
import { configPublicaCobro, MENSAJE_INCONVENIENTE_TECNICO } from "@/lib/pagos/cobrar";
import { publicKeyRechazada } from "@/lib/pagos/mercadopago";

/** Reportes por comprador: un formulario que no arranca se informa una vez; más es ruido o abuso. */
const MAX_REPORTES = 3;
const VENTANA_MS = 10 * 60_000;
const SIN_CACHE = { "Cache-Control": "no-store" };

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * POST /api/pagos/cuenta-rechazada — el navegador informa que el formulario de tarjeta no pudo arrancar
 * porque el procesador rechazó la public key de la cuenta con la que se iba a cobrar el pedido. Body:
 * `{ pedidoId, proveedor, cuenta }`. Si se acepta, queda la evidencia en el pedido (como un 401/403 al
 * cobrar) y se responde la config de la otra cuenta para volver a armar el formulario.
 *
 * El navegador NUNCA elige la cuenta: sólo se acepta el reporte sobre la cuenta que hoy usaría el servidor
 * para ese pedido, del dueño del pedido y con rate limit. Mercado Pago se corrobora con la public key
 * (`publicKeyRechazada`); Payway no tiene cómo corroborarla sin una tarjeta: se acepta del dueño y queda
 * registrado como informado por el cliente (`credenciales_rechazadas:<cuenta>:cliente`).
 */
export async function POST(req: Request) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: SIN_CACHE });
  }
  if (!permitir(`cuenta-rechazada:${clerkUserId ?? cliente?.codigocliente}`, MAX_REPORTES, VENTANA_MS)) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espere unos minutos." },
      { status: 429, headers: SIN_CACHE },
    );
  }

  let body: { pedidoId?: unknown; proveedor?: unknown; cuenta?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400, headers: SIN_CACHE });
  }
  const pedidoId = texto(body.pedidoId, 60);
  const proveedor = texto(body.proveedor, 40);
  const cuenta = texto(body.cuenta, 60);
  if (!pedidoId || !proveedor || !cuenta) {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400, headers: SIN_CACHE });
  }

  const noEncontrado = () =>
    NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404, headers: SIN_CACHE });
  const pedido = await getPedidoParaPago(pedidoId, { clerkUserId, clienteCodigo: cliente?.codigocliente });
  if (!pedido || procesadorDeMedio(pedido.pagoMetodo) !== proveedor) return noEncontrado();
  if (pedido.pagoEstado === "pagado" || motivoNoCobrable(pedido)) {
    return NextResponse.json(
      { error: "Este pedido ya no se puede pagar en línea.", motivo: "pedido_no_cobrable" },
      { status: 409, headers: SIN_CACHE },
    );
  }

  // Sólo la cuenta que el servidor usaría HOY para este pedido: nada de reportar otra para forzar un cambio.
  const vigente = await cuentaParaCobrar(proveedor, pedido);
  if (!vigente.ok || vigente.cuenta !== cuenta) {
    const config = vigente.ok ? configPublicaCobro(proveedor, vigente.cuenta) : null;
    return NextResponse.json(
      {
        error: "La configuración del pago cambió. Vuelva a ingresar los datos de su tarjeta e inténtelo nuevamente.",
        motivo: "cuenta_no_valida",
        ...(config ? { config } : {}),
      },
      { status: 409, headers: SIN_CACHE },
    );
  }

  let origen: "servidor" | "cliente";
  if (proveedor === "mercadopago") {
    const rechazada = await publicKeyRechazada(cuenta);
    if (rechazada !== true) {
      // Mercado Pago acepta la key (o no respondió): el problema no es la cuenta. Sigue la misma config.
      console.warn(`[pagos] cuenta-rechazada sin corroborar procesador=mercadopago cuenta=${cuenta} pedido=${pedido.id}`);
      const config = configPublicaCobro(proveedor, cuenta);
      return NextResponse.json({ cambio: false, ...(config ? { config } : {}) }, { headers: SIN_CACHE });
    }
    origen = "servidor";
  } else {
    origen = "cliente";
  }

  console.error(`[pagos] cuenta_rechazada procesador=${proveedor} cuenta=${cuenta} pedido=${pedido.id} origen=${origen}`);
  try {
    await registrarCuentaRechazada(pedido.id, proveedor, cuenta, vigente.prevista, origen);
  } catch (err) {
    console.error("[/api/pagos/cuenta-rechazada] no se pudo registrar:", err);
    return NextResponse.json({ error: MENSAJE_INCONVENIENTE_TECNICO }, { status: 502, headers: SIN_CACHE });
  }

  const otra = await cuentaParaCobrar(proveedor, pedido);
  const config = otra.ok && otra.cuenta !== cuenta ? configPublicaCobro(proveedor, otra.cuenta) : null;
  if (!config) {
    return NextResponse.json(
      { error: MENSAJE_INCONVENIENTE_TECNICO, motivo: "cuentas_rechazadas" },
      { status: 502, headers: SIN_CACHE },
    );
  }
  return NextResponse.json({ cambio: true, config }, { headers: SIN_CACHE });
}
