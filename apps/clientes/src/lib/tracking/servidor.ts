/**
 * Medición desde el servidor (change `compra-como-invitado`, S2a). SOLO servidor.
 *
 * El invitado vuelve de Mercado Pago con el token de su pedido en la URL, y esa carga NO tiene
 * tracking (`rutaSinTracking`: el Pixel de Meta manda la URL cruda). Por eso su `pedido_confirmado`
 * no se mide en el navegador sino acá, cuando el cobro queda registrado (`registrarCobro`).
 *
 * Va a PostHog por su API de ingesta (HTTP, sin dependencias nuevas), sólo si el flag `tracking`
 * está prendido y hay `POSTHOG_KEY`. Sin datos personales: ni email, ni teléfono, ni documento, ni
 * token; sólo el id del pedido, el total y el medio. El `distinct_id` es el pedido (no hay persona
 * que unir) y el `uuid` es fijo por pedido, así que aunque el aviso llegue dos veces PostHog
 * descarta el repetido. Nunca lanza: medir no puede romper el cobro.
 */
import { createHash } from "crypto";
import { trackingActivo } from "../tracking-flag";
import { hostsPosthog } from "./config";
import { MONEDA } from "./eventos";

export interface MedicionPedidoInvitado {
  pedidoId: string;
  total: number;
  /** `slug` del medio de pago del pedido. */
  medio: string;
}

const TIMEOUT_MS = 3_000;

/** UUID determinístico por pedido (PostHog descarta eventos con el mismo `uuid`). */
export function uuidDeMedicion(pedidoId: string): string {
  const h = createHash("sha256").update(`pedido_confirmado|${pedidoId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** El cuerpo del evento, sin tocar la red (se testea solo). */
export function cuerpoPedidoConfirmado(m: MedicionPedidoInvitado, apiKey: string, ahora: Date = new Date()) {
  return {
    api_key: apiKey,
    event: "pedido_confirmado",
    distinct_id: `pedido:${m.pedidoId}`,
    uuid: uuidDeMedicion(m.pedidoId),
    timestamp: ahora.toISOString(),
    properties: {
      pedido_id: m.pedidoId,
      valor: Math.round(m.total * 100) / 100,
      moneda: MONEDA,
      medio_pago: m.medio,
      compra_invitado: true,
      origen: "servidor",
      // Sin perfil de persona: el pedido no es nadie a quien seguir.
      $process_person_profile: false,
    },
  };
}

export async function medirPedidoConfirmadoInvitado(
  m: MedicionPedidoInvitado,
  /** Inyectable para tests. */
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  try {
    const config = await trackingActivo();
    if (!config?.posthog) return;
    const host = hostsPosthog(process.env.POSTHOG_REGION).ingesta;
    await fetchFn(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoPedidoConfirmado(m, config.posthog.key)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Sólo el id del pedido: nada del comprador.
    console.error(`[tracking] no se pudo medir pedido_confirmado del pedido ${m.pedidoId}`);
  }
}
