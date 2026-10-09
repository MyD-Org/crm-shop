import { NextResponse } from "next/server";
import { ErrorProveedor, type EstadoPago, type ProveedorPago } from "./tipos";
import { pedidoDelPago, registrarCobro } from "@/lib/pedidos";
import { proveedorPago, rasgosProcesador } from "./index";
import { cuentasConSecreto } from "./credenciales";
import { datosCuentas } from "./cuentas-sucursales";

/**
 * Confirmación de cobro de un procesador con webhook. Lo comparten
 * `POST /api/pagos/mercadopago/webhook` (URL registrada en MP) y `POST /api/pagos/[proveedor]/webhook`.
 * El procesador tiene que avisar por webhook (`verificarWebhook`); si no, 404.
 *
 * **Cuenta**: una sola URL registrada en la aplicación de Mercado Pago de CADA sucursal, cada una con su
 * propio secreto (ver credenciales.ts). Se prueba el secreto de cada cuenta: la que valida la firma es
 * la cuenta del aviso, y el pago se consulta con SUS credenciales. La pista
 * `?cuenta=` de la URL sólo ordena la prueba y va a los logs: nunca es autoridad.
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
export async function procesarWebhook(procesadorId: string, req: Request): Promise<Response> {
  const cuerpo = await req.text();

  if (!rasgosProcesador(procesadorId)?.conWebhook) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  let slugs: string[];
  try {
    slugs = (await datosCuentas()).slugs;
  } catch (err) {
    // Sin saber qué cuentas hay no se puede validar: que el procesador reintente.
    console.error(`[webhook ${procesadorId}] no se pudieron leer las cuentas:`, err);
    return NextResponse.json({ error: "Error temporal" }, { status: 500 });
  }
  const conSecreto = procesadorId === "mercadopago" ? cuentasConSecreto("mercadopago", slugs) : [];
  if (conSecreto.length === 0) {
    // 401 como una firma inválida: el procesador lo muestra como entrega fallida y reintenta, que es
    // lo que hace visible un secreto sin cargar.
    console.error(`[webhook ${procesadorId}] ninguna cuenta tiene cargado el secreto del webhook`);
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  const pista = new URL(req.url).searchParams.get("cuenta");
  const orden = pista && conSecreto.includes(pista) ? [pista, ...conSecreto.filter((c) => c !== pista)] : conSecreto;
  let proveedor: ProveedorPago | null = null;
  let referencia: string | undefined;
  for (const cuenta of orden) {
    const candidato = proveedorPago(procesadorId, cuenta);
    const r = await candidato?.verificarWebhook?.(req, cuerpo);
    if (candidato && r?.valido) {
      proveedor = candidato;
      referencia = r.referencia;
      break;
    }
  }
  if (!proveedor) {
    // Un solo log, sin datos del payload. Sin detalle en la respuesta: decirle a quien golpea si
    // falló el timestamp o el HMAC le sirve para ajustar el intento.
    console.error(
      `[webhook ${procesadorId}] firma inválida para las ${orden.length} cuentas con secreto` +
        ` (x-request-id=${req.headers.get("x-request-id") ?? "sin"})`,
    );
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  if (pista && pista !== proveedor.cuenta) {
    console.warn(`[webhook ${procesadorId}] la pista cuenta=${pista} no coincide con la cuenta que firmó (${proveedor.cuenta})`);
  }

  if (!referencia) {
    return NextResponse.json({ ok: true, ignorado: "sin referencia" });
  }

  try {
    let pedido = await pedidoDelPago(proveedor.id, referencia);

    // El payload solo dijo QUÉ mirar. El estado real se le pregunta a MP con
    // el Access Token de la cuenta que firmó el aviso.
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
        console.warn(`[webhook ${proveedor.id}] cuenta=${proveedor.cuenta} referencia inexistente en MP: ${referencia}`);
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
      `[webhook ${proveedor.id}] cuenta=${proveedor.cuenta} pedido=${pedido.id} ${pedido.pagoEstado} -> ${estado.estado}` +
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
