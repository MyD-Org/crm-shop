import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { catalogoSoloVisibles } from "@/lib/catalogo-flag";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { opcionesCuotasDePedido } from "@/lib/cuotas-opciones";
import { combinarOpcionesCuotas, type CuotasRestringidas, type OpcionCuotasPedido } from "@/lib/cuotas-pedido";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";
import { idListaDelMedio } from "@/lib/lista-medio";
import { esCompradorCuentaCorriente, procesadorDeMedio } from "@/lib/medios-pago";
import { leerMediosPagoTolerante } from "@/lib/medios-pago-repo";
import { credencialesMercadoPago } from "@/lib/pagos/credenciales";
import { cuentaParaCobrar } from "@/lib/pagos/cuentas-sucursales";
import { MARCAS_TARJETA, marcaDeMercadoPago, nombreDeMarca } from "@/lib/pagos/marcas";
import { consultarPlanesMP, type PlanesMP } from "@/lib/pagos/mercadopago-planes";
import { pedidoParaCambiarMedio } from "@/lib/pedidos";
import { permitirAsync } from "@/lib/rate-limit";

/** Respuesta: lo que el formulario de pago necesita para el desplegable "Cuotas". */
export interface OpcionesCuotasPedido {
  procesador: { id: string; nombre: string };
  /** Mercado Pago: la public key de la cuenta del pedido (resolver de credenciales). */
  publicKey?: string;
  /** Total del pedido a la lista del pago único. Recotizado; no se persiste. */
  precioUnPago: number;
  /** Lo congelado hoy en el pedido. */
  actual: { cuotas: number | null; total: number };
  marca: { id: string | null; nombre?: string; logo?: string } | null;
  opciones: OpcionCuotasPedido[];
  restringidas: CuotasRestringidas[];
  /** false = no hay cuotas con interés (Mercado Pago no respondió, o el procesador no las ofrece). */
  conInteres: { disponible: boolean };
}

/** Se llama al montar el formulario y en cada cambio de BIN (con debounce): techo holgado. */
const MAX_POR_MINUTO = 30;
/** Sin tarjeta cargada, los planes con interés se muestran con esta marca de referencia. */
const MARCA_REFERENCIA_MP = "visa";

const NO_ENCONTRADO = { error: "No encontramos ese pedido." };
const IDS_MARCAS: readonly string[] = MARCAS_TARJETA.map((m) => m.id);

/**
 * POST /api/pedidos/:id/cuotas — opciones de cuotas del formulario de pago de un pedido pendiente
 * propio. Body: `{ bin?: "6 a 8 dígitos", marca?: <id canónico> }` (POST para que el BIN no viaje en la
 * URL). SIN EFECTOS: no crea ni cambia nada.
 *
 * Junta las cuotas sin interés de la tienda (cotizadas sobre las líneas del PEDIDO, cada cantidad con su
 * lista, con su mínimo y filtradas por la marca de la tarjeta) con los planes con interés que Mercado
 * Pago informa para el BIN, consultados acá con el access token de la cuenta (sin BIN: los de una
 * tarjeta Visa de referencia). Si Mercado Pago no responde, `conInteres.disponible` es false y sólo
 * quedan 1 pago y las sin interés. Payway: sin cuotas con interés; la marca la manda el navegador.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const quien = clerkUserId ? `clerk:${clerkUserId}` : `cliente:${cliente!.codigocliente}`;
  if (!await permitirAsync(`pedido-cuotas:${quien}`, MAX_POR_MINUTO, 60_000)) {
    return NextResponse.json(
      { error: "Hizo demasiados intentos. Espere un minuto e inténtelo de nuevo." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { id } = await ctx.params;
  let body: { bin?: unknown; marca?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (body.bin !== undefined && (typeof body.bin !== "string" || !/^\d{6,8}$/.test(body.bin))) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (body.marca !== undefined && (typeof body.marca !== "string" || !IDS_MARCAS.includes(body.marca))) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const bin = body.bin as string | undefined;
  const marcaElegida = body.marca as string | undefined;

  try {
    const pedido = id
      ? await pedidoParaCambiarMedio(id, { clerkUserId, clienteCodigo: cliente?.codigocliente })
      : null;
    // No existe, es de otro o ya no está pendiente: el mismo 404 genérico.
    if (!pedido) return NextResponse.json(NO_ENCONTRADO, { status: 404 });

    const procesadorId = procesadorDeMedio(pedido.pagoMetodo);
    if (!procesadorId) {
      return NextResponse.json(
        { error: "Este pedido no se paga en línea.", motivo: "sin_cobro_en_linea" },
        { status: 409 },
      );
    }

    // Sin caché: rige lo último del admin (condiciones, mínimos, marcas).
    const medios = await leerMediosPagoTolerante();
    const medio = medios.find((m) => m.slug === pedido.pagoMetodo);
    if (!medio) {
      return NextResponse.json(
        { error: "No pudimos verificar el medio de pago. Inténtelo de nuevo en unos minutos.", motivo: "medio_no_verificado" },
        { status: 502 },
      );
    }

    // Lista privada o cuenta corriente: el precio no depende del medio ni hay cuotas sin interés.
    const idListaPrivada = cliente ? await listaPrivadaDelComprador() : null;
    const conSinInteres = !idListaPrivada && !esCompradorCuentaCorriente(cliente) && (await cuotasHabilitadas());
    const { opciones: cotizadas } = await opcionesCuotasDePedido({
      lineas: pedido.lineas,
      medio: { condicionesCuotas: conSinInteres ? (medio.condicionesCuotas ?? []) : [] },
      idListaUnPago: idListaDelMedio(medios, pedido.entregaTipo, pedido.pagoMetodo, undefined, 1),
      opcionesCotizar: { entregaTipo: pedido.entregaTipo, idListaPrivada, soloVisibles: await catalogoSoloVisibles() },
      // El pedido ya reserva sus unidades.
      ignorarStock: true,
    });
    const precioUnPago = cotizadas.find((o) => o.cuotas === 1)?.total;
    if (precioUnPago === undefined) {
      return NextResponse.json(
        {
          error: "Algunos productos cambiaron y no se pueden calcular las cuotas. Revise su pedido.",
          motivo: "productos_cambiaron",
        },
        { status: 409 },
      );
    }

    // Planes de Mercado Pago: con BIN, los de esa tarjeta; sin BIN, los de referencia.
    // Con la cuenta de Mercado Pago del pedido (la de su sucursal): los planes y la public key son de ella.
    let planes: PlanesMP | null = null;
    let mpDisponible = false;
    const cuentaMp = procesadorId === "mercadopago" ? await cuentaParaCobrar("mercadopago", { ...pedido, id }) : null;
    if (cuentaMp?.ok) {
      const r = await consultarPlanesMP(
        bin
          ? { amount: precioUnPago, bin, cuenta: cuentaMp.cuenta }
          : { amount: precioUnPago, paymentMethodId: MARCA_REFERENCIA_MP, cuenta: cuentaMp.cuenta },
      );
      mpDisponible = r.ok;
      planes = r.ok ? r.entrada : null;
    }

    const tarjetaCargada = Boolean(bin || marcaElegida);
    const marcaId =
      procesadorId === "mercadopago" && bin ? (marcaDeMercadoPago(planes?.metodoPagoId) ?? marcaElegida ?? null) : (marcaElegida ?? null);
    const { opciones, restringidas } = combinarOpcionesCuotas({
      sinInteres: cotizadas,
      condiciones: conSinInteres ? (medio.condicionesCuotas ?? []) : [],
      marca: marcaId,
      tarjetaCargada,
      planes,
      planesDeLaTarjeta: Boolean(bin),
    });

    const publicKey = cuentaMp?.ok ? credencialesMercadoPago(cuentaMp.cuenta).publicKey : null;
    const respuesta: OpcionesCuotasPedido = {
      procesador: { id: procesadorId, nombre: medio.nombre },
      ...(publicKey ? { publicKey } : {}),
      precioUnPago,
      actual: { cuotas: pedido.cuotas, total: pedido.total },
      marca: tarjetaCargada
        ? {
            id: marcaId,
            ...(marcaId ? { nombre: nombreDeMarca(marcaId) } : {}),
            ...(bin && planes?.logo ? { logo: planes.logo } : {}),
          }
        : null,
      opciones,
      restringidas,
      conInteres: { disponible: mpDisponible },
    };
    return NextResponse.json(respuesta);
  } catch (err) {
    console.error("[/api/pedidos/:id/cuotas] POST error:", err);
    return NextResponse.json(
      { error: "No pudimos calcular las cuotas. Inténtelo de nuevo en un momento." },
      { status: 500 },
    );
  }
}
