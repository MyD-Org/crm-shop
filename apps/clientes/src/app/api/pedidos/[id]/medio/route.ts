import { NextResponse, after } from "next/server";
import { identidadActual } from "@/lib/auth";
import { catalogoSoloVisibles } from "@/lib/catalogo-flag";
import { marcarStockCambiado } from "@/lib/cache-invalidar";
import { contactoDelPedido } from "@/lib/contacto-pedido-repo";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";
import { leerMediosPagoTolerante } from "@/lib/medios-pago-repo";
import { esCompradorCuentaCorriente, pagoValidoConMedios } from "@/lib/medios-pago";
import { medioAdmiteCambio } from "@/lib/cambiar-medio-pago";
import { SLUG_TRANSFERENCIA } from "@/lib/cuentas-bancarias";
import { procesadorConfigurado } from "@/lib/pagos";
import { proveedorDeIntento } from "@/lib/pagos/cuentas-sucursales";
import { resolverIntentoAbierto } from "@/lib/pagos/intento-abierto";
import { configMpPara } from "@/lib/pagos/mp-public-key";
import { avisarOperadorPedidoNuevo, avisarPedidoRecibido, avisarPedidoSiFalta, avisoOperadorAlCrear } from "@/lib/pedido-avisos";
import { cotizarConMedio } from "@/lib/pedido-medio";
import { cambiarMedioPedido, intentoAbiertoDelPedido, lineasDelPedidoParaCarrito, pedidoParaCambiarMedio } from "@/lib/pedidos";
import { permitir } from "@/lib/rate-limit";
import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";

/**
 * POST /api/pedidos/:id/medio — cambia el medio de pago (o las cuotas) de un pedido pendiente con
 * cobro en línea, SOBRE EL MISMO pedido: mismo id y número, sin crear otro. Body: `{ pagoMetodo,
 * cuotas?, totalVisto? }`.
 *
 * Todo se decide en el servidor: dueño, estado, que no haya un cobro en vuelo ni un pago informado
 * (409), que el medio sea ofrecible para la entrega del pedido y el comprador (cuenta corriente,
 * credenciales del procesador, mínimos de cuotas) y los precios, que se recotizan con la lista del
 * medio nuevo con las MISMAS funciones que crear el pedido (`cotizarConMedio`). Las cantidades no
 * cambian: la reserva de stock se mantiene (la cotización ignora el stock que el propio pedido ya
 * reserva). Si algo quedó sin precio o no disponible, 409 y el pedido sigue como estaba. Con un medio
 * sin cobro en línea se manda "pedido recibido" (una vez: la clave de idempotencia del aviso es por
 * pedido); con uno en línea no se avisa nada hasta el pago.
 */
const MAX_CAMBIOS_POR_MINUTO = 10;

const MENSAJE_PAGO_EN_CURSO =
  "Este pedido tiene un pago en proceso. Espere unos minutos a que se confirme antes de cambiar el medio de pago.";

const conflicto = (error: string, motivo: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, motivo, ...extra }, { status: 409 });

/**
 * GET /api/pedidos/:id/medio — las líneas del pedido pendiente propio (para devolverlas al carrito
 * cuando el cobro ya lo vació), su entrega y su contacto (para precargar el checkout y volver directo
 * al paso Pago con un pedido retomado).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await ctx.params;
  const pedido = id ? await pedidoParaCambiarMedio(id, { clerkUserId, clienteCodigo: cliente?.codigocliente }) : null;
  if (!pedido) return NextResponse.json({ error: "No se pudo cambiar el medio de pago" }, { status: 404 });
  return NextResponse.json({
    items: await lineasDelPedidoParaCarrito(id),
    entrega: { tipo: pedido.entregaTipo, ...pedido.entrega },
    contacto: pedido.contacto,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const quien = clerkUserId ? `clerk:${clerkUserId}` : `cliente:${cliente!.codigocliente}`;
  if (!permitir(`pedido-medio:${quien}`, MAX_CAMBIOS_POR_MINUTO, 60_000)) {
    return NextResponse.json(
      { error: "Hizo demasiados intentos. Espere un minuto e inténtelo de nuevo." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Falta el pedido" }, { status: 400 });

  let body: { pagoMetodo?: unknown; cuotas?: unknown; totalVisto?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const pagoMetodo = typeof body.pagoMetodo === "string" ? body.pagoMetodo.trim().slice(0, 40) : "";
  if (!pagoMetodo) return NextResponse.json({ error: "Indique el medio de pago." }, { status: 400 });

  const dueno = { clerkUserId, clienteCodigo: cliente?.codigocliente };

  try {
    const pedido = await pedidoParaCambiarMedio(id, dueno);
    // No existe, es de otro o ya no está pendiente: el mismo 404 genérico que cancelar.
    if (!pedido) return NextResponse.json({ error: "No se pudo cambiar el medio de pago" }, { status: 404 });
    if (!medioAdmiteCambio(pedido.pagoMetodo)) {
      return conflicto("Este pedido ya no admite cambiar el medio de pago.", "no_cambia");
    }

    // Un cobro en vuelo se cierra o se espera: igual que antes de cancelar (consulta al procesador).
    const abierto = await intentoAbiertoDelPedido(id, dueno);
    if (abierto) {
      // Con las credenciales de la cuenta del pedido (la misma con la que se cobró).
      const proveedor = await proveedorDeIntento(abierto);
      const resolucion = proveedor ? await resolverIntentoAbierto(id, abierto, proveedor) : "en_curso";
      if (resolucion === "pagado") {
        return conflicto(
          "Este pedido ya se pagó, así que no se puede cambiar el medio de pago. Escríbanos si necesita modificarlo.",
          "pagado",
        );
      }
      if (resolucion === "en_curso") return conflicto(MENSAJE_PAGO_EN_CURSO, "pago_en_curso");
    }

    // Medio ofrecible HOY para la entrega del pedido y el comprador (releído sin caché).
    const mediosCrm = await leerMediosPagoTolerante();
    const opcionesMedios = {
      procesadorDisponible: procesadorConfigurado,
      esCuentaCorriente: esCompradorCuentaCorriente(cliente),
    };
    if (!pagoValidoConMedios(mediosCrm, pedido.entregaTipo, pagoMetodo, opcionesMedios)) {
      return NextResponse.json(
        { error: "Ese medio de pago no está disponible para la entrega elegida." },
        { status: 400 },
      );
    }

    const idListaPrivada = cliente ? await listaPrivadaDelComprador() : null;
    const resuelto = await cotizarConMedio({
      lineas: pedido.lineas,
      entregaTipo: pedido.entregaTipo,
      pagoMetodo,
      cuotasPedidas: body.cuotas,
      mediosCrm,
      opcionesMedios,
      idListaPrivada,
      soloVisibles: await catalogoSoloVisibles(),
      ignorarStock: true,
      origen: "/api/pedidos/:id/medio",
    });
    if (!resuelto.ok) {
      return NextResponse.json(
        { error: TEXTOS_CUOTAS.cuotasNoDisponibles, motivo: "cuotas_no_disponibles" },
        { status: 422 },
      );
    }
    const { cuotasPedido, idListaMedio, cotizacion } = resuelto;

    if (cotizacion.hayProblemas) {
      return conflicto(
        cotizacion.lineas.some((l) => l.sinPrecio)
          ? "Hay productos sin precio para su cuenta. Consulte con un asesor."
          : "Algunos productos cambiaron y no se puede cambiar el medio de pago. Su pedido quedó como estaba.",
        "productos_cambiaron",
        { cotizacion },
      );
    }

    // El comprador confirma lo que vio: si el total con el medio nuevo difiere, no se toca nada.
    const totalVisto = typeof body.totalVisto === "number" && Number.isFinite(body.totalVisto) ? body.totalVisto : null;
    if (totalVisto !== null && Math.abs(totalVisto - cotizacion.total) >= 0.005) {
      return conflicto(
        "El precio de algunos productos cambió. Revise el nuevo total antes de confirmar.",
        "precio_cambio",
        { totalNuevo: cotizacion.total, cotizacion },
      );
    }

    const r = await cambiarMedioPedido(id, dueno, {
      pagoMetodo,
      cuotas: cuotasPedido,
      idPriceList: idListaPrivada ?? idListaMedio ?? null,
      cotizacion,
    });
    if (!r.ok) {
      switch (r.motivo) {
        case "no_existe":
          return NextResponse.json({ error: "No se pudo cambiar el medio de pago" }, { status: 404 });
        case "no_cambia":
          return conflicto("Este pedido ya no admite cambiar el medio de pago.", "no_cambia");
        case "pago_en_curso":
          return conflicto(MENSAJE_PAGO_EN_CURSO, "pago_en_curso");
        case "pago_informado":
          return conflicto(
            "Este pedido ya tiene un pago informado y no se puede cambiar el medio de pago desde la tienda. Comuníquese con nosotros.",
            "pago_informado",
          );
        case "lineas_distintas":
          return conflicto(
            "El pedido cambió. Revíselo antes de elegir otro medio de pago.",
            "productos_cambiaron",
          );
      }
    }

    // La reserva cambió de vencimiento: el listado cacheado se renueva. Nunca tira.
    marcarStockCambiado("cambiar el medio de pago de un pedido");

    // Avisos (ver `avisarPedidoSiFalta`):
    // - Si todavía no salieron (lo normal: el comprador cambia desde la pantalla de transferencia), no
    //   hay nada que corregir. Con cobro en línea salen al aprobarse el pago; con transferencia, al irse
    //   de la pantalla o desde el cron; con otro medio sin cobro en línea, ahora.
    // - Si ya salieron por transferencia (cambió después del cron), el local recibe "Cambió el medio
    //   de pago" y, si el medio nuevo es sin cobro en línea, el comprador otro "recibido".
    const desdeTransferenciaAvisada =
      pedido.pagoMetodo === SLUG_TRANSFERENCIA && pagoMetodo !== SLUG_TRANSFERENCIA && pedido.avisosEnviados;
    if (desdeTransferenciaAvisada) {
      after(async () => {
        if (avisoOperadorAlCrear(pagoMetodo)) await avisarPedidoRecibido(id, pagoMetodo);
        await avisarOperadorPedidoNuevo(id, { medioAnterior: pedido.pagoMetodo });
      });
    } else if (avisoOperadorAlCrear(pagoMetodo) && pagoMetodo !== SLUG_TRANSFERENCIA) {
      after(() => avisarPedidoSiFalta(id).then(() => undefined));
    }

    const contacto = await contactoDelPedido(id, r.numero);
    return NextResponse.json({
      id: r.id,
      numero: r.numero,
      cuotas: r.cuotas,
      total: r.total,
      cuentaPago: r.cuentaPago,
      cotizacion,
      ...(contacto ? { contacto } : {}),
      ...(await configMpPara({ id, sucursal: pedido.sucursal, facturaSucursal: pedido.facturaSucursal }, pagoMetodo)),
    });
  } catch (err) {
    console.error("[/api/pedidos/:id/medio] POST error:", err);
    return NextResponse.json(
      { error: "No pudimos cambiar el medio de pago. Inténtelo de nuevo en un momento." },
      { status: 500 },
    );
  }
}
