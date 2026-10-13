import { randomUUID } from "node:crypto"
import { requireAdminPlus } from "@/lib/admin-route-guard"
import { basePublicaFotos, getShopMediaR2, marcaKey } from "@/lib/shop-media"
import { CONTENT_TYPE_MARCA, EXTENSIONES_MARCA, type ExtensionMarca } from "@/lib/tienda-online"

// POST /api/admin/settings/tienda-online/logo — firma la subida de una imagen de la marca (logo,
// ícono, imagen para compartir) al bucket público `shop-media`, bajo `marca/{tenant}/`.
//
// El archivo no pasa por el servidor: el navegador sube directo a R2 con la URL firmada y después
// guarda la URL pública con el PUT de /api/admin/settings/tienda-online (que valida host, extensión
// y que la imagen esté bajo el prefijo de ESTE tenant).

const NO_STORE = { "Cache-Control": "private, no-store" }
const TTL_FIRMA_S = 600
const MAX_BYTES = 2 * 1024 * 1024

function invalido(error: string) {
  return Response.json({ error, code: "invalid" }, { status: 400, headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const r2 = getShopMediaR2()
  const base = basePublicaFotos()
  if (!r2 || !base) {
    return Response.json(
      { error: "El almacenamiento de imágenes no está configurado. Avise al administrador." },
      { status: 503, headers: NO_STORE },
    )
  }

  const body = (await req.json().catch(() => null)) as { ext?: unknown; bytes?: unknown } | null
  const ext = body?.ext
  if (typeof ext !== "string" || !(EXTENSIONES_MARCA as readonly string[]).includes(ext)) {
    return invalido("El formato de la imagen no es válido. Use SVG, PNG, WebP o JPG.")
  }
  const bytes = Number(body?.bytes)
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES) {
    return invalido("La imagen supera el tamaño permitido (2 MB).")
  }

  const key = marcaKey(guard.tenantId, randomUUID(), ext as ExtensionMarca)
  const { url, headers } = await r2.presignPut(key, {
    contentType: CONTENT_TYPE_MARCA[ext as ExtensionMarca],
    contentLength: bytes,
    ttlSeconds: TTL_FIRMA_S,
  })

  return Response.json({ key, url, headers, publicUrl: `${base}/${key}` }, { headers: NO_STORE })
}
