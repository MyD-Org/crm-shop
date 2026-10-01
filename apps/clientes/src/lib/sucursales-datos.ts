/**
 * Sucursales y zonas para MOSTRAR (selector de zona del catálogo). SOLO servidor.
 *
 * Sale de `'use cache: remote'` con el tag `sucursales` y el perfil `sucursales` (5 minutos): al
 * guardar en el CRM, el ping de `/api/internal/sucursales/revalidar` la vence al instante. Las
 * decisiones que escriben un pedido NO usan esto: releen sin caché dentro de la transacción
 * (`leerSucursalesYZonas`, en `crearPedido`).
 *
 * Si la lectura falla devuelve vacío con el perfil `degradado` (minutos): el selector no se
 * muestra y nada más se rompe. La lectura filtra por `tenant_id = shopTenantId()`.
 */
import { cacheLife, cacheTag } from "next/cache";
import { TAG_SUCURSALES } from "./cache-tags";
import {
  REGLAS_VENTA_DEFAULT,
  leerConfigEnvio,
  leerReglasVenta,
  leerSucursalesYZonas,
  type DatosSucursales,
  type ReglasVentaTenant,
} from "./sucursales-repo";

export async function sucursalesCacheadas(): Promise<DatosSucursales> {
  "use cache: remote";
  cacheTag(TAG_SUCURSALES);
  try {
    const datos = await leerSucursalesYZonas();
    cacheLife("sucursales");
    return datos;
  } catch (err) {
    console.error(
      "[sucursales-datos] no se pudieron leer las sucursales:",
      err,
    );
    cacheLife("degradado");
    return { sucursales: [], zonas: [] };
  }
}

/**
 * Reglas de venta para MOSTRAR (demora de traslado, retiro con o sin respaldo, envío con respaldo).
 * Mismo tag y mismo perfil que las sucursales: el ping del CRM las vence al guardar. Falla =
 * defaults con el perfil `degradado`. La decisión que escribe un pedido relee sin caché. Incluye la
 * configuración de envío (`envio`, con el default si esa lectura aparte falla).
 */
export async function reglasVentaCacheadas(): Promise<ReglasVentaTenant> {
  "use cache: remote";
  cacheTag(TAG_SUCURSALES);
  try {
    const [reglas, envio] = await Promise.all([leerReglasVenta(), leerConfigEnvio()]);
    cacheLife("sucursales");
    return { ...reglas, envio };
  } catch (err) {
    console.error("[sucursales-datos] no se pudieron leer las reglas de venta:", err);
    cacheLife("degradado");
    return REGLAS_VENTA_DEFAULT;
  }
}
