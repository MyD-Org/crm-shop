// Ping al Shop. SIN payload, así un ping no puede inyectar configuración.
//   - sucursales → el Shop descarta la caché de sucursales/zonas (y la del catálogo, que depende de
//     ellas) para mostrar el cambio de reglas sin esperar el TTL. La ruta del lado del Shop es
//     la tarea A.2.3; hasta que exista el ping responde 404 y queda como no propagado.
//   - catálogo → el Shop ya lee el catálogo comercial directo de estas tablas (misma base); el
//     ping sólo le hace descartar lo que tenga renderizado en caché, para que el cambio se vea
//     en la próxima visita.
//
// Se llama DESPUÉS de persistir y NUNCA tira: si el Shop no responde, el guardado ya quedó.
// `propagado` es true sólo si el Shop contestó 2xx con el JSON `{ ok: true }` (un 200 con HTML,
// como el de la cortina del gate, no cuenta).
// Un tenant puede tener varios Shops (change `dominios-clerk-por-host`): se avisa a todos, cada uno
// con SU secreto (SHOP_CRM_SECRET_<SLUG>[__<ETIQUETA>]); los logs llevan la etiqueta, nunca la URL
// ni el secreto.
// El destino (URL + secreto) se resuelve POR TENANT (src/lib/shop-destino.ts): el `tenantId` es
// obligatorio, así un ping nunca puede ir al Shop de otro tenant ni llevar su secreto. Sin destino
// (ej. entornos sin Shop, o URL propia sin su SHOP_CRM_SECRET_<SLUG>) es un no-op.
//
// `path` NUNCA viene de un input: son las dos constantes de acá. La función genérica es privada
// y se expone un wrapper por destino, así el call site no puede elegir a dónde pega.

import { resolverDestinosShop } from "@/lib/shop-destino"
import { leerFilaShop } from "@/lib/shop-destino-db"

export const PING_TIMEOUT_MS = 5000

const PATH_CATALOGO = "/api/internal/catalogo/revalidar"
const PATH_SUCURSALES = "/api/internal/sucursales/revalidar"
// Marca del tenant (nombre, logos, textos): el Shop descarta su caché de marca y de home/footer.
// La ruta del lado del Shop es la rebanada 3b; hasta que exista responde 404 → no propagado.
const PATH_MARCA = "/api/internal/marca/revalidar"

/** `{ ok: true }` en JSON; cualquier otra cosa (HTML, JSON sin `ok: true`, cuerpo roto) es false. */
async function esRespuestaOk(res: Response): Promise<boolean> {
  try {
    const cuerpo: unknown = await res.json()
    return typeof cuerpo === "object" && cuerpo !== null && (cuerpo as { ok?: unknown }).ok === true
  } catch {
    return false
  }
}

/** Resultado de un ping. `fallidos` (etiquetas) solo aparece si hubo un fallo en un fan-out (2+ destinos); no cambia a los call sites. */
export interface ResultadoPing {
  propagado: boolean
  fallidos?: string[]
}

/** Un solo destino: su propio timeout y su propio bearer en el closure. Nunca tira. */
async function pingDestino(
  destino: { etiqueta: string; urlInterna: string; secret: string },
  path: string,
  log: string,
): Promise<boolean> {
  const { etiqueta, urlInterna: base, secret } = destino
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) {
      console.warn(`[${log}] ping al Shop (${etiqueta}) respondió ${res.status}`)
      return false
    }
    // Un 200 no alcanza: la cortina "Próximamente" del Shop (o cualquier intermediario) contesta
    // 200 con HTML. Sólo cuenta como entregado el JSON `{ ok: true }` de la ruta del Shop.
    if (!(await esRespuestaOk(res))) {
      console.warn(`[${log}] ping al Shop (${etiqueta}) respondió 200 pero no es el JSON esperado ({ ok: true })`)
      return false
    }
    return true
  } catch (err) {
    console.warn(`[${log}] ping al Shop (${etiqueta}) falló: ${err instanceof Error ? err.name : "error"}`)
    return false
  } finally {
    clearTimeout(timer)
  }
}

// Fan-out: el principal más los destinos extra del tenant, en paralelo (el total queda en ~5 s, no
// en la suma). Un fallo no aborta a los demás. `propagado` es true solo si TODOS respondieron OK y
// no quedó ningún destino configurado pero inutilizable; sin destinos es false (como siempre).
async function pingShopRevalidar(tenantId: string, path: string, log: string): Promise<ResultadoPing> {
  const fila = await leerFilaShop(tenantId)
  const { destinos, omitidos } = resolverDestinosShop(tenantId, fila, process.env)
  if (destinos.length === 0) return { propagado: false }

  const resultados = await Promise.allSettled(
    destinos.map((d) => pingDestino({ etiqueta: d.etiqueta, urlInterna: d.urlInterna as string, secret: d.secret as string }, path, log)),
  )
  const fallidos = [
    ...destinos.filter((_, i) => !(resultados[i].status === "fulfilled" && resultados[i].value)).map((d) => d.etiqueta),
    ...omitidos,
  ]
  if (fallidos.length === 0) return { propagado: true }
  // Con un solo destino configurado (el caso de siempre) no hay a quién distinguir: la forma
  // del resultado queda idéntica a la previa. `fallidos` aparece solo en un fan-out real.
  return destinos.length + omitidos.length > 1 ? { propagado: false, fallidos } : { propagado: false }
}

export const pingShopRevalidarCatalogo = (tenantId: string): Promise<ResultadoPing> =>
  pingShopRevalidar(tenantId, PATH_CATALOGO, "catalogo")

export const pingShopRevalidarSucursales = (tenantId: string): Promise<ResultadoPing> =>
  pingShopRevalidar(tenantId, PATH_SUCURSALES, "sucursales")

export const pingShopRevalidarMarca = (tenantId: string): Promise<ResultadoPing> =>
  pingShopRevalidar(tenantId, PATH_MARCA, "marca")
