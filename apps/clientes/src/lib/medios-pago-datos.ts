/**
 * Medios de pago del CRM para MOSTRAR (paso Pago del checkout, detalle del pedido, mail). SOLO
 * servidor.
 *
 * `'use cache: remote'` con el tag `sucursales` y el perfil `sucursales` (5 minutos): al guardar en
 * "Sucursales y ventas" del CRM, el ping de `/api/internal/sucursales/revalidar` la vence al
 * instante. La validación que decide si un pedido se crea NO usa esto: relee sin caché
 * (`leerMediosPagoTolerante`). Falla (tabla ausente, permiso) = `[]` con el perfil `degradado`.
 * Si la lectura cacheada misma falla, se lee la base directo (`conRespaldoSinCache`).
 */
import { cacheLife, cacheTag } from "next/cache";
import { conRespaldoSinCache } from "./cache-respaldo";
import { TAG_SUCURSALES } from "./cache-tags";
import { leerMediosPago } from "./medios-pago-repo";
import { SLUG_MERCADOPAGO, type MedioPago } from "./medios-pago";
import { mercadoPagoConfigurado } from "./pagos/mercadopago";

async function mediosPagoDeCache(): Promise<MedioPago[]> {
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

export function mediosPagoCacheados(): Promise<MedioPago[]> {
  return conRespaldoSinCache("medios-pago", mediosPagoDeCache, () => leerMediosPago().catch(() => []));
}

/** Quita `mercadopago` de la lista si el Shop no tiene credenciales para cobrar. */
export function sinMpSiNoConfigurado(medios: readonly MedioPago[]): MedioPago[] {
  return mercadoPagoConfigurado() ? [...medios] : medios.filter((m) => m.slug !== SLUG_MERCADOPAGO);
}

/** Medios para OFRECER (checkout, Envíos y pagos): los cacheados, sin MP si faltan credenciales. */
export async function mediosOfrecibles(): Promise<MedioPago[]> {
  return sinMpSiNoConfigurado(await mediosPagoCacheados());
}

