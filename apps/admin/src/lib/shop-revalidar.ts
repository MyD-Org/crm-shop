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
// El destino (URL + secreto) se resuelve POR TENANT (src/lib/shop-destino.ts): el `tenantId` es
// obligatorio, así un ping nunca puede ir al Shop de otro tenant ni llevar su secreto. Sin destino
// (ej. entornos sin Shop, o URL propia sin su SHOP_CRM_SECRET_<SLUG>) es un no-op.
//
// `path` NUNCA viene de un input: son las dos constantes de acá. La función genérica es privada
// y se expone un wrapper por destino, así el call site no puede elegir a dónde pega.

import { resolverDestinoShop } from "@/lib/shop-destino"
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

async function pingShopRevalidar(
  tenantId: string,
  path: string,
  etiqueta: string,
): Promise<{ propagado: boolean }> {
  const fila = await leerFilaShop(tenantId)
  const destino = resolverDestinoShop(tenantId, fila, process.env)
  if (!destino || !destino.urlInterna || !destino.secret) return { propagado: false }
  const { urlInterna: base, secret } = destino

  const url = `${base}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) {
      console.warn(`[${etiqueta}] ping al Shop respondió ${res.status}`)
      return { propagado: false }
    }
    // Un 200 no alcanza: la cortina "Próximamente" del Shop (o cualquier intermediario) contesta
    // 200 con HTML. Sólo cuenta como entregado el JSON `{ ok: true }` de la ruta del Shop.
    if (!(await esRespuestaOk(res))) {
      console.warn(`[${etiqueta}] ping al Shop respondió 200 pero no es el JSON esperado ({ ok: true })`)
      return { propagado: false }
    }
    return { propagado: true }
  } catch (err) {
    console.warn(`[${etiqueta}] ping al Shop falló: ${err instanceof Error ? err.name : "error"}`)
    return { propagado: false }
  } finally {
    clearTimeout(timer)
  }
}

export const pingShopRevalidarCatalogo = (tenantId: string): Promise<{ propagado: boolean }> =>
  pingShopRevalidar(tenantId, PATH_CATALOGO, "catalogo")

export const pingShopRevalidarSucursales = (tenantId: string): Promise<{ propagado: boolean }> =>
  pingShopRevalidar(tenantId, PATH_SUCURSALES, "sucursales")

export const pingShopRevalidarMarca = (tenantId: string): Promise<{ propagado: boolean }> =>
  pingShopRevalidar(tenantId, PATH_MARCA, "marca")
