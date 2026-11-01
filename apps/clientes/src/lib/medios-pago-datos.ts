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
import { procesadorDeMedio, type MedioPago } from "./medios-pago";
import { procesadorConfigurado } from "./pagos";
import { mediosSegunComprador, mediosSegunPublico } from "./mercadopago-flag";

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

/** Quita los medios con cobro en línea cuyo procesador no tiene credenciales en el Shop. */
export function sinProcesadoresNoConfigurados(medios: readonly MedioPago[]): MedioPago[] {
  return medios.filter((m) => {
    const procesador = procesadorDeMedio(m.slug);
    return procesador === null || procesadorConfigurado(procesador);
  });
}

/**
 * Medios que ve CUALQUIER visitante (precios "con X", Envíos y pagos): los cacheados, sin los
 * procesadores sin credenciales y sin Mercado Pago salvo que su flag esté prendido para todos.
 */
export async function mediosOfrecibles(): Promise<MedioPago[]> {
  return mediosSegunPublico(sinProcesadoresNoConfigurados(await mediosPagoCacheados()));
}

/** Medios que puede elegir el comprador del request (checkout): Mercado Pago según su flag. */
export async function mediosOfreciblesComprador(): Promise<MedioPago[]> {
  return mediosSegunComprador(sinProcesadoresNoConfigurados(await mediosPagoCacheados()));
}

