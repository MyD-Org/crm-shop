import { requireSeccion } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { MAX_IDS_PRECIOS, preciosEtiquetasDelShop } from "@/lib/etiquetas-precios-shop"

// POST /api/admin/etiquetas/precios — body { ids: string[] } (alegraIds de la lista de impresión)
//   → { precios: { [alegraId]: { precioLista, precioMedio: { nombre, rotulo, precio } | null } } }
// Los precios son los de la card del catálogo del Shop del tenant (ver lib/etiquetas-precios-shop.ts).
// Con la sección (requireSeccion: sin sesión → 401, sin la sección → 404). Tenant = el del guard, siempre.

const ID_RE = /^(?:\d+|[a-z][a-z0-9-]{1,11}:\d+)$/

const error = (mensaje: string, status: number) => Response.json({ error: mensaje }, { status, headers: NO_STORE })

export async function POST(req: Request) {
  const guard = await requireSeccion(req, "etiquetas")
  if (!guard.ok) return guard.response

  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return error("La solicitud no es válida.", 400)
  }
  const crudos = (cuerpo as { ids?: unknown } | null)?.ids
  if (!Array.isArray(crudos) || crudos.length > MAX_IDS_PRECIOS) {
    return error(`Indique hasta ${MAX_IDS_PRECIOS} productos.`, 400)
  }
  const ids = [...new Set(crudos.filter((x): x is string => typeof x === "string" && ID_RE.test(x)))]

  const r = await preciosEtiquetasDelShop(guard.tenantId, ids)
  if (!r.ok) {
    return r.motivo === "sin-shop"
      ? error("La tienda no tiene una tienda web configurada; no se pueden obtener los precios.", 409)
      : error("No se pudieron obtener los precios de la tienda web. Inténtelo nuevamente.", 502)
  }
  return Response.json({ precios: r.precios }, { headers: NO_STORE })
}
