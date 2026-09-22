// Ping al Shop. SIN payload, así un ping no puede inyectar configuración.
//   - cuotas   → el Shop vuelve a leer del CRM (contrato platform/contracts/cuotas/v2, punto 2)
//   - catálogo → el Shop ya lee el catálogo comercial directo de estas tablas (misma base); el
//     ping sólo le hace descartar lo que tenga renderizado en caché, para que el cambio se vea
//     en la próxima visita.
//
// Se llama DESPUÉS de persistir y NUNCA tira: si el Shop no responde, el guardado ya quedó.
// Sin SHOP_INTERNAL_URL o SHOP_CRM_SECRET (ej. entornos sin Shop) es un no-op.
//
// `path` NUNCA viene de un input: son las dos constantes de acá. La función genérica es privada
// y se expone un wrapper por destino, así el call site no puede elegir a dónde pega.

export const PING_TIMEOUT_MS = 5000

const PATH_CUOTAS = "/api/internal/cuotas/revalidar"
const PATH_CATALOGO = "/api/internal/catalogo/revalidar"

async function pingShopRevalidar(path: string, etiqueta: string): Promise<{ propagado: boolean }> {
  const base = process.env.SHOP_INTERNAL_URL?.trim()
  const secret = process.env.SHOP_CRM_SECRET
  if (!base || !secret) return { propagado: false }

  const url = `${base.replace(/\/+$/, "")}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) console.warn(`[${etiqueta}] ping al Shop respondió ${res.status}`)
    return { propagado: res.ok }
  } catch (err) {
    console.warn(`[${etiqueta}] ping al Shop falló: ${err instanceof Error ? err.name : "error"}`)
    return { propagado: false }
  } finally {
    clearTimeout(timer)
  }
}

export const pingShopRevalidarCuotas = (): Promise<{ propagado: boolean }> =>
  pingShopRevalidar(PATH_CUOTAS, "cuotas")

export const pingShopRevalidarCatalogo = (): Promise<{ propagado: boolean }> =>
  pingShopRevalidar(PATH_CATALOGO, "catalogo")
