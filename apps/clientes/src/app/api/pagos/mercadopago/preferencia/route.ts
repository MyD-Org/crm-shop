import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { VENTANA_PAGO_MS, getPedidoParaPago, motivoNoCobrable, registrarCuentaRechazada } from "@/lib/pedidos";
import { procesadorDeMedio } from "@/lib/medios-pago";
import { permitirAsync } from "@/lib/rate-limit";
import { crearPreferencia } from "@/lib/pagos/mercadopago";
import { procesadorConfigurado } from "@/lib/pagos";
import { candidatasDelPedido } from "@/lib/pagos/cuentas-sucursales";
import { esCredencialRechazada } from "@/lib/pagos/tipos";
import { armarPreferencia } from "@/lib/pagos/mercadopago-preferencia";
import { rechazoPorOpcionDeCobro } from "@/lib/pagos/opcion-cobro-guard";

const MAX_PEDIDOS = 20;
const VENTANA_MS = 5 * 60_000;

/**
 * POST /api/pagos/mercadopago/preferencia — crea la preferencia para pagar con la cuenta de Mercado Pago
 * un pedido propio ya creado, y devuelve la URL de Mercado Pago a la que se lleva al comprador.
 *
 * No cobra nada: el comprador paga en el flujo de Mercado Pago, vuelve a `/checkout?pedido=<id>` y el
 * webhook (o la consulta del sondeo) registra el cobro por `registrarCobro`, por `external_reference`.
 * Monto y referencia salen SIEMPRE del pedido persistido, nunca del body. La preferencia se crea con
 * la cuenta de Mercado Pago del pedido (la de su sucursal) o, si no se puede, con otra configurada; el
 * webhook identifica la cuenta por su firma.
 */
export async function POST(req: Request) {
  const { clerkUserId, cliente, email } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sinCuenta = () =>
    NextResponse.json(
      { error: "Los pagos en línea no están disponibles en este momento.", motivo: "mp_no_configurado" },
      { status: 409 },
    );
  if (!procesadorConfigurado("mercadopago")) return sinCuenta();

  if (!await permitirAsync(`pago-pref:${clerkUserId ?? cliente?.codigocliente}`, MAX_PEDIDOS, VENTANA_MS)) {
    return NextResponse.json({ error: "Demasiados intentos. Espere unos minutos." }, { status: 429 });
  }

  let pedidoId = "";
  try {
    const body = (await req.json()) as { pedidoId?: unknown };
    pedidoId = typeof body.pedidoId === "string" ? body.pedidoId.trim().slice(0, 60) : "";
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!pedidoId) return NextResponse.json({ error: "Falta el pedido." }, { status: 400 });

  const pedido = await getPedidoParaPago(pedidoId, {
    clerkUserId,
    clienteCodigo: cliente?.codigocliente,
  });
  if (!pedido || procesadorDeMedio(pedido.pagoMetodo) !== "mercadopago") {
    return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });
  }
  if (pedido.pagoEstado === "pagado") {
    return NextResponse.json({ error: "Este pedido ya está pagado.", motivo: "pagado" }, { status: 409 });
  }
  if (motivoNoCobrable(pedido)) {
    return NextResponse.json(
      { error: "Este pedido ya no se puede pagar en línea.", motivo: "pedido_no_cobrable" },
      { status: 409 },
    );
  }
  // La cuenta de Mercado Pago puede estar deshabilitada para el medio en el admin (migración 0073).
  const rechazoOpcion = await rechazoPorOpcionDeCobro(pedido.pagoMetodo, "mercadopago", "cuenta_mp");
  if (rechazoOpcion) return rechazoOpcion;
  /**
   * Cuentas usables, la prevista primero (`candidatasDelPedido`). Acá no hay tarjeta tokenizada: si Mercado
   * Pago rechaza las credenciales de una cuenta (401/403), se prueba la siguiente en el mismo request, sin
   * que el comprador tenga que hacer nada. Cualquier otro error corta (no se repite con otra cuenta).
   */
  const { prevista, candidatas } = await candidatasDelPedido("mercadopago", pedido);
  const usables = candidatas.filter((c) => c.configurada && !c.rechazada).map((c) => c.cuenta);
  if (usables.length === 0) return sinCuenta();
  for (const cuenta of usables) {
    try {
      const url = await crearPreferencia(
        cuenta,
        armarPreferencia({
          cuenta,
          pedidoId: pedido.id,
          numero: pedido.numero,
          total: pedido.total,
          origen: new URL(req.url).origin,
          emailComprador: pedido.clienteEmail ?? cliente?.email ?? email ?? undefined,
          cuotas: pedido.cuotas,
          venceEn: new Date(pedido.creadoEn.getTime() + VENTANA_PAGO_MS),
        }),
      );
      if (cuenta !== prevista) {
        console.warn(`[pagos] preferencia con otra cuenta pedido=${pedido.id} prevista=${prevista} cuenta=${cuenta}`);
      }
      return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      if (esCredencialRechazada(err)) {
        console.error(`[pagos] cuenta_rechazada procesador=mercadopago cuenta=${cuenta} pedido=${pedido.id} status=${err.status}`);
        // Evidencia en el pedido: el cobro con tarjeta tampoco vuelve a probar esta cuenta.
        await registrarCuentaRechazada(pedido.id, "mercadopago", cuenta, prevista, "servidor").catch((e) =>
          console.error("[/api/pagos/mercadopago/preferencia] no se pudo registrar la cuenta rechazada:", e),
        );
        continue;
      }
      console.error("[/api/pagos/mercadopago/preferencia] error:", err);
      break;
    }
  }
  return NextResponse.json(
    { error: "No pudimos habilitar el pago con cuenta de Mercado Pago. Puede pagar con tarjeta." },
    { status: 502 },
  );
}
