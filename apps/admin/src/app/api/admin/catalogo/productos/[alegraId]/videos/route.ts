import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, conUrlDeFotos, NO_STORE, rechazarSiVarianteAgrupada, validacionResponse } from "@/lib/catalogo-admin"
import { detalleProducto, guardarOverlay } from "@/lib/catalogo-overlay-repo"
import { idDeRuta } from "@/lib/shop-media"
import { validarVideos } from "@/lib/video-youtube"

// PUT /api/admin/catalogo/productos/[alegraId]/videos — persiste la lista final de videos de YouTube.
//
// Cuerpo: { videos: [{ id }] } con ids de 11 caracteres (el navegador extrae el id del enlace con
// `idYoutubeDeEnlace`; acá se vuelve a validar). Máx. 3, sin repetir. Persiste aparte del PATCH del
// diálogo, igual que las fotos.
// Variantes de un modelo: los videos del modelo se editan sobre el ancla; los PROPIOS de una variante
// se editan con `?alcance=variante` (escribe sólo `videos` en el overlay de la variante).
//
// admin+ (operator → 404). Tenant = el del guard, siempre.

interface Params {
  params: Promise<{ alegraId: string }>
}

export async function PUT(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const alegraId = idDeRuta((await params).alegraId)
  if (!(await detalleProducto(guard.tenantId, alegraId))) return adminNotFoundResponse()
  const rechazo = await rechazarSiVarianteAgrupada(req, guard.tenantId, alegraId, { permitirFotoPropia: true })
  if (rechazo) return rechazo

  const body = (await req.json().catch(() => null)) as { videos?: unknown } | null
  if (!body) return validacionResponse("El cuerpo del pedido no es JSON válido.", "body")
  const validado = validarVideos(body.videos)
  if (!validado.ok) return validacionResponse(validado.error, "videos")

  await guardarOverlay(guard.tenantId, alegraId, { videos: validado.videos }, guard.user.id)
  const producto = await detalleProducto(guard.tenantId, alegraId)
  if (!producto) return adminNotFoundResponse()

  await avisarShop(guard.tenantId)
  return Response.json({ producto: conUrlDeFotos(producto) }, { headers: NO_STORE })
}
