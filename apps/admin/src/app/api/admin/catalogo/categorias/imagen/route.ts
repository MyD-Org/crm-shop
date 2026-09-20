import { randomUUID } from "node:crypto"
import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE, validacionResponse } from "@/lib/catalogo-admin"
import { getShopMediaR2 } from "@/lib/shop-media"

// POST /api/admin/catalogo/categorias/imagen — firma la subida de la foto de una categoría.
//
// Mismo mecanismo que las fotos de producto: el archivo no pasa por el servidor, el navegador la
// redimensiona y sube directo a R2 con una URL firmada. La key se persiste después, con el PATCH
// de la categoría.
//
// Una sola variante: estas fotos son tarjetas de portada, no galerías.

const TTL_FIRMA_S = 600
const MAX_BYTES = 5 * 1024 * 1024
const ANCHO = 800

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const r2 = getShopMediaR2()
  if (!r2) {
    return Response.json(
      { error: "El almacenamiento de fotos no está configurado. Avise al administrador." },
      { status: 503, headers: NO_STORE },
    )
  }

  const body = (await req.json().catch(() => null)) as { bytes?: unknown } | null
  const bytes = Number(body?.bytes)
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES) {
    return validacionResponse("La imagen supera el tamaño permitido.", "bytes")
  }

  // El prefijo `categorias/` es el mismo que valida `validarCategoria` al persistir la key: sin
  // eso, un PATCH podría apuntar la categoría a una foto de producto o de otro tenant.
  const key = `categorias/${guard.tenantId}/${randomUUID()}-${ANCHO}.webp`
  const { url, headers } = await r2.presignPut(key, {
    contentType: "image/webp",
    contentLength: bytes,
    ttlSeconds: TTL_FIRMA_S,
  })

  return Response.json({ key, url, headers, ancho: ANCHO }, { headers: NO_STORE })
}
