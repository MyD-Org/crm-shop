/**
 * Sucursales y zonas para MOSTRAR (selector de zona del catálogo). SOLO servidor.
 *
 * Sale de `'use cache: remote'` con el tag `sucursales` y el perfil `sucursales` (5 minutos): al
 * guardar en el CRM, el ping de `/api/internal/sucursales/revalidar` la vence al instante. Las
 * decisiones que escriben un pedido NO usan esto: releen sin caché dentro de la transacción
 * (`leerSucursalesYZonas`, en `crearPedido`).
 *
 * Si la lectura falla devuelve vacío con el perfil `degradado` (minutos): el selector no se
 * muestra y nada más se rompe. La lectura filtra por `tenant_id = shopTenantId()`. Si falla la caché
 * misma, se lee sin caché (`conRespaldoSinCache`).
 */
import { cacheLife, cacheTag } from "next/cache";
import { conRespaldoSinCache } from "./cache-respaldo";
import { TAG_SUCURSALES } from "./cache-tags";
import {
  REGLAS_VENTA_DEFAULT,
  leerConfigDespacho,
  leerConfigEnvio,
  leerReglasVenta,
  leerSucursalesYZonas,
  type DatosSucursales,
  type ReglasVentaTenant,
} from "./sucursales-repo";

export function sucursalesCacheadas(): Promise<DatosSucursales> {
  return conRespaldoSinCache("sucursales", sucursalesDeCache, () =>
    leerSucursalesYZonas().catch(() => ({ sucursales: [], zonas: [] })),
  );
}

async function sucursalesDeCache(): Promise<DatosSucursales> {
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
 * configuración de envío (`envio`, con el default si esa lectura aparte falla). Con `envioZona` (flag
 * `envio-por-zona`) también los métodos de envío por zona (`envio.metodos`).
 */
export function reglasVentaCacheadas(envioZona = false): Promise<ReglasVentaTenant> {
  return conRespaldoSinCache("reglas-venta", () => reglasVentaDeCache(envioZona), () =>
    Promise.all([leerReglasVenta(), leerConfigEnvio(undefined, { conMetodos: envioZona }), leerConfigDespacho()])
      .then(([reglas, envio, despacho]) => ({ ...reglas, envio, despacho }))
      .catch(() => REGLAS_VENTA_DEFAULT),
  );
}

/**
 * `envioZona` = flag `envio-por-zona` (`FlagsPublicos.envioZona`): entra como argumento para que sea
 * parte de la clave de la caché (prenderlo se ve en la lectura siguiente) y, apagado, ni se leen las
 * tablas de métodos de envío.
 */
async function reglasVentaDeCache(envioZona: boolean): Promise<ReglasVentaTenant> {
  "use cache: remote";
  cacheTag(TAG_SUCURSALES);
  try {
    const [reglas, envio, despacho] = await Promise.all([
      leerReglasVenta(),
      leerConfigEnvio(undefined, { conMetodos: envioZona }),
      leerConfigDespacho(),
    ]);
    cacheLife("sucursales");
    return { ...reglas, envio, despacho };
  } catch (err) {
    console.error("[sucursales-datos] no se pudieron leer las reglas de venta:", err);
    cacheLife("degradado");
    return REGLAS_VENTA_DEFAULT;
  }
}
