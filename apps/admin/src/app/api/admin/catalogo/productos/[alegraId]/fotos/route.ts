import { randomUUID } from "node:crypto"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, conUrlDeFotos, NO_STORE, validacionResponse } from "@/lib/catalogo-admin"
import { detalleProducto, guardarOverlay } from "@/lib/catalogo-overlay-repo"
import { ANCHOS_FOTO, esAnchoValido, fotoKey, getShopMediaR2 } from "@/lib/shop-media"

// POST /api/admin/catalogo/productos/[alegraId]/fotos — firma la subida de UNA foto.
// PUT  /api/admin/catalogo/productos/[alegraId]/fotos — persiste la lista final (alta, orden, alt).
//
// El archivo NUNCA pasa por el servidor: el navegador redimensiona, pide acá una URL PUT firmada
// por variante y sube directo a R2. Así se esquiva el límite de 4,5 MB de body de Vercel y no se
// paga el tránsito dos veces.
//
// Se firma contra el bucket PÚBLICO (`getShopMediaR2`), nunca contra el de comprobantes.
// admin+ (operator → 404). Tenant = el del guard, siempre.

interface Params {
  params: Promise<{ alegraId: string }>
}

/** Ventana de la firma. Alcanza para tres variantes de una foto en una conexión lenta. */
const TTL_FIRMA_S = 600

/** Tope por variante ya redimensionada. El original grande no llega nunca hasta acá. */
const MAX_BYTES_VARIANTE = 5 * 1024 * 1024

export async function POST(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const r2 = getShopMediaR2()
  if (!r2) {
    return Response.json(
      { error: "El almacenamiento de fotos no está configurado. Avise al administrador." },
      { status: 503, headers: NO_STORE },
    )
  }

  const { alegraId } = await params
  if (!(await detalleProducto(guard.tenantId, alegraId))) return adminNotFoundResponse()

  const body = (await req.json().catch(() => null)) as { id?: unknown; variantes?: unknown } | null
  if (!body) return validacionResponse("El cuerpo del pedido no es JSON válido.", "body")

  // El id lo elige el cliente para que las tres variantes compartan prefijo, pero se valida acá:
  // es parte de la key y nada que venga del navegador entra sin revisar.
  const id = typeof body.id === "string" ? body.id : randomUUID()

  const variantes = body.variantes
  if (!Array.isArray(variantes) || variantes.length === 0 || variantes.length > ANCHOS_FOTO.length) {
    return validacionResponse("Indique las variantes de la foto.", "variantes")
  }

  const firmadas = []
  for (const v of variantes as { ancho?: unknown; bytes?: unknown }[]) {
    const ancho = Number(v?.ancho)
    const bytes = Number(v?.bytes)
    if (!esAnchoValido(ancho)) return validacionResponse(`El ancho ${v?.ancho} no está permitido.`, "variantes")
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES_VARIANTE) {
      return validacionResponse("La imagen supera el tamaño permitido.", "variantes")
    }

    let key: string
    try {
      key = fotoKey(guard.tenantId, alegraId, id, ancho)
    } catch {
      return validacionResponse("No pudimos preparar la subida de esa imagen.", "variantes")
    }

    // contentType y contentLength van DENTRO de la firma: R2 rechaza con 403 un PUT que no matchee,
    // así que la URL firmada no sirve para subir otra cosa ni un archivo más grande.
    const { url, headers } = await r2.presignPut(key, {
      contentType: "image/webp",
      contentLength: bytes,
      ttlSeconds: TTL_FIRMA_S,
    })
    firmadas.push({ ancho, key, url, headers })
  }

  return Response.json({ id, variantes: firmadas }, { headers: NO_STORE })
}

export async function PUT(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { alegraId } = await params
  if (!(await detalleProducto(guard.tenantId, alegraId))) return adminNotFoundResponse()

  const body = (await req.json().catch(() => null)) as { fotos?: unknown } | null
  if (!body || !Array.isArray(body.fotos)) return validacionResponse("Indique las fotos del producto.", "fotos")

  const prefijoDelTenant = `productos/${guard.tenantId}/${alegraId}/`
  const fotos = []
  for (const f of body.fotos as { key?: unknown; w?: unknown; alt?: unknown }[]) {
    const key = typeof f?.key === "string" ? f.key : ""
    const w = Number(f?.w)
    // Sin esta comprobación, un PUT podría hacer que el producto de un tenant apunte a la foto de
    // otro: la key viene del navegador y el prefijo es lo único que la ata a este producto.
    if (!key.startsWith(prefijoDelTenant) || key.includes("..")) {
      return validacionResponse("Una de las fotos no pertenece a este producto.", "fotos")
    }
    if (!esAnchoValido(w)) return validacionResponse("Una de las fotos tiene un tamaño inesperado.", "fotos")
    const alt = typeof f?.alt === "string" ? f.alt.trim().slice(0, 200) : ""
    fotos.push({ key, w, ...(alt ? { alt } : {}) })
  }

  await guardarOverlay(guard.tenantId, alegraId, { fotos }, guard.user.id)
  const producto = await detalleProducto(guard.tenantId, alegraId)
  if (!producto) return adminNotFoundResponse()

  await avisarShop(guard.tenantId)
  return Response.json({ producto: conUrlDeFotos(producto) }, { headers: NO_STORE })
}
