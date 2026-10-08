/**
 * Lado navegador de la consulta del estado del pago (`GET /api/pedidos/[id]/pago`). Módulo puro: el
 * `fetch` y el reloj se inyectan, así lo usan el checkout y el detalle del pedido y se prueba sin DOM.
 */

/** Cuánto se sigue consultando antes de dar la espera por agotada y mandar a Mi cuenta. */
export const VENTANA_SONDEO_MS = 3 * 60_000;

/**
 * Pausa antes de la consulta número `n` (0 = la primera): cada 5 s el primer medio minuto, cada 10 s
 * el minuto siguiente y cada 15 s después. El procesador tarda pero no hay motivo para insistir igual
 * de seguido cuando ya pasó un rato.
 */
export function esperaSondeo(n: number): number {
  if (n < 6) return 5_000;
  if (n < 12) return 10_000;
  return 15_000;
}

export type ResultadoSondeo =
  | { fase: "pagado" }
  | { fase: "pendiente" }
  /** Rechazado: `cobrable` = se puede volver a pagar este mismo pedido. */
  | { fase: "rechazado"; mensaje: string; cobrable: boolean }
  /** No hay nada que seguir consultando (sin sesión o pedido inexistente). */
  | { fase: "perdido" }
  /**
   * El pedido sigue pendiente y no hay ningún cobro en curso: el envío nunca llegó al procesador (se
   * cortó la conexión antes). Quien sondea lo da por "no se cobró" si se repite (ver `useSondeoPago`).
   */
  | { fase: "sinCobro" };

/** Lo que se le dice al comprador cuando el cobro nunca salió: nada que esperar, puede reintentar. */
export const MENSAJE_SIN_COBRO =
  "No se realizó ningún cobro: el pago no llegó a enviarse. Inténtelo de nuevo o elija otro medio de pago.";

interface RespuestaEstado {
  estado?: string;
  mensaje?: string;
  cobrable?: boolean;
  sinCobro?: boolean;
}

const MENSAJE_NO_COBRABLE =
  "Este pedido ya no se puede pagar en línea. Si todavía desea la compra, genere un pedido nuevo desde el carrito.";

export async function consultarPagoDelPedido(
  pedidoId: string,
  doFetch: typeof fetch = fetch,
  /** Id del pago con el que volvió de Mercado Pago (`payment_id`): el servidor lo consulta si no lo conoce. */
  pagoMercadoPagoId?: string,
): Promise<ResultadoSondeo> {
  let res: Response;
  const query = pagoMercadoPagoId ? `?pago_mp=${encodeURIComponent(pagoMercadoPagoId)}` : "";
  try {
    res = await doFetch(`/api/pedidos/${encodeURIComponent(pedidoId)}/pago${query}`, { cache: "no-store" });
  } catch {
    // Sin conexión un rato: se sigue esperando, no es un resultado.
    return { fase: "pendiente" };
  }
  if (res.status === 401 || res.status === 404) return { fase: "perdido" };
  if (!res.ok) return { fase: "pendiente" };

  const json = (await res.json().catch(() => ({}))) as RespuestaEstado;
  if (json.estado === "pagado") return { fase: "pagado" };
  if (json.estado === "fallido") {
    const cobrable = json.cobrable !== false;
    const mensaje = json.mensaje ?? "No pudimos procesar el pago. Inténtelo de nuevo o elija otro medio de pago.";
    return { fase: "rechazado", mensaje: cobrable ? mensaje : `${mensaje} ${MENSAJE_NO_COBRABLE}`, cobrable };
  }
  if (json.sinCobro) return { fase: "sinCobro" };
  return { fase: "pendiente" };
}
