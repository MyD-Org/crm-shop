import { randomUUID } from "node:crypto"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, conUrlDeFicha, NO_STORE, validacionResponse } from "@/lib/catalogo-admin"
import { detalleProducto, guardarOverlay } from "@/lib/catalogo-overlay-repo"
import { fichaKey, getShopMediaR2 } from "@/lib/shop-media"

// POST   /api/admin/catalogo/productos/[alegraId]/ficha — firma la subida del PDF.
// PUT    /api/admin/catalogo/productos/[alegraId]/ficha — persiste la ficha ya subida.
// DELETE /api/admin/catalogo/productos/[alegraId]/ficha — quita la ficha (overlay y R2).
//
// Mismo patrón que /fotos: el archivo NUNCA pasa por el servidor. El navegador pide acá una URL
// PUT firmada y sube directo a R2 (evita el límite de body de Vercel y el tránsito doble). Se
// firma contra el bucket PÚBLICO (`getShopMediaR2`), nunca contra el de comprobantes.
//
// A diferencia de las fotos, la ficha es UN solo archivo, no una lista de variantes: el PUT
// reemplaza la key anterior (si había) y la vieja se borra de R2 después de guardar, para no
// dejar objetos huérfanos. admin+ (operator → 404). Tenant = el del guard, siempre.

interface Params {
  params: Promise<{ alegraId: string }>
}

/** Ventana de la firma. Un PDF de hasta 10 MB en una conexión lenta puede tardar. */
const TTL_FIRMA_S = 600

/** Tope del archivo. Un PDF de ficha técnica no debería superar esto; si lo hace, es otra cosa. */
const MAX_BYTES_FICHA = 10 * 1024 * 1024

export async function POST(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const r2 = getShopMediaR2()
  if (!r2) {
    return Response.json(
      { error: "El almacenamiento de archivos no está configurado. Avise al administrador." },
      { status: 503, headers: NO_STORE },
    )
  }

  const { alegraId } = await params
  if (!(await detalleProducto(guard.tenantId, alegraId))) return adminNotFoundResponse()

  const body = (await req.json().catch(() => null)) as { nombre?: unknown; bytes?: unknown } | null
  if (!body) return validacionResponse("El cuerpo del pedido no es JSON válido.", "body")

  const nombre = typeof body.nombre === "string" ? body.nombre.trim().slice(0, 200) : ""
  if (!nombre) return validacionResponse("Indique el archivo a subir.", "nombre")

  const bytes = Number(body.bytes)
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES_FICHA) {
    return validacionResponse(`El archivo no puede superar los ${MAX_BYTES_FICHA / 1024 / 1024} MB.`, "bytes")
  }

  const id = randomUUID()
  let key: string
  try {
    key = fichaKey(guard.tenantId, alegraId, id)
  } catch {
    return validacionResponse("No pudimos preparar la subida de ese archivo.", "nombre")
  }

  // contentType y contentLength van DENTRO de la firma: R2 rechaza con 403 un PUT que no
  // matchee, así que la URL firmada no sirve para subir otra cosa ni un archivo más grande.
  const { url, headers } = await r2.presignPut(key, {
    contentType: "application/pdf",
    contentLength: bytes,
    ttlSeconds: TTL_FIRMA_S,
  })

  return Response.json({ key, url, headers, nombre, bytes }, { headers: NO_STORE })
}

export async function PUT(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { alegraId } = await params
  const anterior = await detalleProducto(guard.tenantId, alegraId)
  if (!anterior) return adminNotFoundResponse()

  const body = (await req.json().catch(() => null)) as { key?: unknown; nombre?: unknown; bytes?: unknown } | null
  if (!body) return validacionResponse("El cuerpo del pedido no es JSON válido.", "body")

  const key = typeof body.key === "string" ? body.key : ""
  const prefijoDelTenant = `productos/${guard.tenantId}/${alegraId}/`
  // Sin esta comprobación, un PUT podría hacer que el producto de un tenant apunte a la ficha de
  // otro: la key viene del navegador y el prefijo es lo único que la ata a este producto.
  if (!key.startsWith(prefijoDelTenant) || key.includes("..")) {
    return validacionResponse("La ficha técnica no pertenece a este producto.", "key")
  }
  const nombre = typeof body.nombre === "string" ? body.nombre.trim().slice(0, 200) : ""
  if (!nombre) return validacionResponse("Indique el nombre del archivo.", "nombre")
  const bytes = Number(body.bytes)
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES_FICHA) {
    return validacionResponse("El archivo no es válido.", "bytes")
  }

  const keyAnterior = anterior.fichaTecnica?.key ?? null
  await guardarOverlay(guard.tenantId, alegraId, { fichaTecnica: { key, nombre, bytes } }, guard.user.id)

  // Borrar la ficha vieja DESPUÉS de guardar la nueva, y sólo si cambió la key: así una carga que
  // fallara a mitad de camino nunca deja al producto sin ninguna ficha en R2.
  if (keyAnterior && keyAnterior !== key) {
    const r2 = getShopMediaR2()
    if (r2) await r2.delete(keyAnterior).catch(() => {})
  }

  const producto = await detalleProducto(guard.tenantId, alegraId)
  if (!producto) return adminNotFoundResponse()

  await avisarShop(guard.tenantId)
  return Response.json({ producto: conUrlDeFicha(producto) }, { headers: NO_STORE })
}

export async function DELETE(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { alegraId } = await params
  const anterior = await detalleProducto(guard.tenantId, alegraId)
  if (!anterior) return adminNotFoundResponse()

  await guardarOverlay(guard.tenantId, alegraId, { fichaTecnica: null }, guard.user.id)

  if (anterior.fichaTecnica) {
    const r2 = getShopMediaR2()
    if (r2) await r2.delete(anterior.fichaTecnica.key).catch(() => {})
  }

  const producto = await detalleProducto(guard.tenantId, alegraId)
  if (!producto) return adminNotFoundResponse()

  await avisarShop(guard.tenantId)
  return Response.json({ producto: conUrlDeFicha(producto) }, { headers: NO_STORE })
}
