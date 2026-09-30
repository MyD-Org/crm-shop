/**
 * Medios de pago del CRM para MOSTRAR (paso Pago del checkout, detalle del pedido, mail). SOLO
 * servidor.
 *
 * `'use cache: remote'` con el tag `sucursales` y el perfil `sucursales` (5 minutos): al guardar en
 * "Sucursales y ventas" del CRM, el ping de `/api/internal/sucursales/revalidar` la vence al
 * instante. La validación que decide si un pedido se crea NO usa esto: relee sin caché
 * (`leerMediosPagoTolerante`). Falla (tabla ausente, permiso) = `[]` con el perfil `degradado`.
 */
import { cacheLife, cacheTag } from "next/cache";
import { TAG_SUCURSALES } from "./cache-tags";
import { leerMediosPago } from "./medios-pago-repo";
import type { MedioPago } from "./medios-pago";

export async function mediosPagoCacheados(): Promise<MedioPago[]> {
  "use cache: remote";
  cacheTag(TAG_SUCURSALES);
  try {
    const medios = await leerMediosPago();
    cacheLife("sucursales");
    return medios;
  } catch (err) {
    console.warn(
      "[medios-pago-datos] no se pudieron leer los medios de pago del CRM:",
      err instanceof Error ? err.message : err,
    );
    cacheLife("degradado");
    return [];
  }
}
