import { NextResponse } from "next/server";
import { ErrorProveedor, type EstadoPago, type ProveedorPago } from "./tipos";
import { pedidoDelPago, registrarCobro } from "@/lib/pedidos";

/**
 * Confirmación de cobro de un procesador con webhook. Lo comparten
 * `POST /api/pagos/mercadopago/webhook` (URL registrada en MP) y `POST /api/pagos/[proveedor]/webhook`.
 * El proveedor tiene que implementar `verificarWebhook` (quien llama ya filtró el que no).
 *
 * **Esta ruta es la única fuente de verdad del estado de pago.** La URL de
 * retorno del comprador se puede escribir a mano en la barra del navegador; una
 * notificación firmada por Mercado Pago, no.
 *
 * Corre SIN sesión de Clerk y SIN el gate del sitio: Mercado Pago no tiene
 * cookies. Ver la excepción en `src/proxy.ts` — sin ella, MP recibe la página
 * de "Próximamente" con un 200, cree que entregó bien, y ningún pago se
 * confirma jamás.
 *
 * Casi todo devuelve 200. Un status de error hace que MP reintente, y reintentar
 * algo que nunca vamos a poder procesar —un topic que no manejamos, un id que no
 * es nuestro— es ruido infinito. El 401 se reserva para la firma inválida, que
 * es lo único que amerita que MP deje de intentarlo.
 */
export async function procesarWebhook(
  proveedor: ProveedorPago,
  req: Request,
): Promise<Response> {
  const cuerpo = await req.text();

  const verificar = proveedor.verificarWebhook?.bind(proveedor);
  if (!verificar) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const { valido, referencia } = await verificar(req, cuerpo);
  if (!valido) {
    // Sin detalle en la respuesta: decirle a quien golpea si falló el timestamp
    // o el HMAC le sirve para ajustar el intento.
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  if (!referencia) {
    return NextResponse.json({ ok: true, ignorado: "sin referencia" });
  }

  try {
    let pedido = await pedidoDelPago(proveedor.id, referencia);

    // El payload solo dijo QUÉ mirar. El estado real se le pregunta a MP con
    // nuestro Access Token.
    let estado: EstadoPago;
    try {
      estado = await proveedor.consultarPago(referencia);
    } catch (err) {
      /**
       * Un 404 de MP es un id que no existe para esta cuenta: pruebas desde el
       * panel, eventos de otros topics. Reintentarlo es ruido infinito. Con
       * cualquier otro error sí conviene que MP reintente (cae al 500).
       */
      if (err instanceof ErrorProveedor && err.status === 404 && !pedido) {
        console.warn(`[webhook ${proveedor.id}] referencia inexistente en MP: ${referencia}`);
        return NextResponse.json({ ok: true, ignorado: "referencia desconocida" });
      }
      throw err;
    }

    /**
     * La base no conoce este pago: se busca el pedido por el
     * `external_reference` que informa MP. Así se rescata un intento viejo que
     * se aprueba después de que el comprador reintentó, o uno cuya respuesta
     * de creación nunca llegó a guardarse. Antes esto se descartaba, y quedaba
     * un pago cobrado sin registrar.
     */
    pedido ??= await pedidoDelPago(proveedor.id, referencia, estado.pedidoId);

    // Sigue sin pedido: es de otro entorno (dev y prod comparten la cuenta de
    // MP) o de algo que no es un pedido del Shop. No es un error nuestro.
    if (!pedido) {
      console.warn(`[webhook ${proveedor.id}] referencia sin pedido: ${referencia}`);
      return NextResponse.json({ ok: true, ignorado: "referencia desconocida" });
    }

    const cambio = await registrarCobro(pedido.id, {
      proveedor: proveedor.id,
      referencia,
      estado: estado.estado,
      detalle: estado.detalle,
      reversion: estado.reversion,
      cuotas: estado.cuotasPagadas,
      totalPagado: estado.totalPagado,
      ...(estado.info ? { info: estado.info } : {}),
    });

    console.log(
      `[webhook ${proveedor.id}] pedido=${pedido.id} ${pedido.pagoEstado} -> ${estado.estado}` +
        ` (${estado.detalle || "sin detalle"}) ${cambio ? "APLICADO" : "sin cambio"}`,
    );

    return NextResponse.json({ ok: true, cambio });
  } catch (err) {
    /**
     * Acá SÍ conviene el 500: si Mercado Pago o nuestra base fallaron, el
     * reintento de MP es exactamente lo que queremos. Es la diferencia entre
     * "no puedo procesarlo nunca" y "no pude ahora".
     */
    console.error(`[webhook ${proveedor.id}] error procesando:`, err);
    return NextResponse.json({ error: "Error temporal" }, { status: 500 });
  }
}
