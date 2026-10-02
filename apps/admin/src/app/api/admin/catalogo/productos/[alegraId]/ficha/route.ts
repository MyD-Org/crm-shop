import { randomUUID } from "node:crypto"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, conUrlDeFicha, conflictoResponse, NO_STORE, validacionResponse } from "@/lib/catalogo-admin"
import { MAX_BYTES_FICHA, sha256Hex } from "@/lib/catalogo-ficha-contenido"
import { borrarFichaSiHuerfana, contarReferenciasFicha } from "@/lib/catalogo-ficha-repo"
import { detalleProducto, guardarOverlay } from "@/lib/catalogo-overlay-repo"
import { fichaContenidoKey, fichaKey, getShopMediaR2, shaDeFichaContenidoKey } from "@/lib/shop-media"

// GET    /api/admin/catalogo/productos/[alegraId]/ficha — el PDF, para el visor del admin.
// POST   /api/admin/catalogo/productos/[alegraId]/ficha — firma la subida del PDF.
// PUT    /api/admin/catalogo/productos/[alegraId]/ficha — persiste la ficha ya subida.
// DELETE /api/admin/catalogo/productos/[alegraId]/ficha — quita la ficha (overlay y R2).
//
// Mismo patrón que /fotos: el archivo NUNCA pasa por el servidor. El navegador pide acá una URL
// PUT firmada y sube directo a R2 (evita el límite de body de Vercel y el tránsito doble). Se
// firma contra el bucket PÚBLICO (`getShopMediaR2`), nunca contra el de comprobantes.
//
// A diferencia de las fotos, la ficha es UN solo archivo, no una lista de variantes: el PUT
// reemplaza la key anterior (si había).
//
// ARCHIVO POR CONTENIDO: el navegador manda el sha256 del PDF y la key sale de él
// (`productos/{tenant}/fichas/{sha256}.pdf`). Si el objeto ya existe NO se vuelve a subir: el
// producto sólo apunta a él. Varios productos pueden compartir el mismo objeto, así que reemplazar
// o quitar una ficha NUNCA borra el objeto si otro producto del tenant todavía lo referencia.
// Sin sha256 en el POST (cliente viejo) se mantiene la key propia del producto.
//
// admin+ (operator → 404). Tenant = el del guard, siempre.

interface Params {
  params: Promise<{ alegraId: string }>
}

/** Ventana de la firma. Un PDF de hasta 10 MB en una conexión lenta puede tardar. */
const TTL_FIRMA_S = 600

const SHA256_RE = /^[0-9a-f]{64}$/

/**
 * El PDF de la ficha, PROXEADO desde R2 para el `DocumentViewer` del DS: el visor lo baja con
 * `fetch` y necesita mismo origen (la URL pública de R2 es otro origen). `?download=1` lo baja
 * como archivo; sin eso se sirve inline.
 */
export async function GET(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { alegraId } = await params
  const producto = await detalleProducto(guard.tenantId, alegraId)
  if (!producto?.fichaTecnica) return adminNotFoundResponse()

  const r2 = getShopMediaR2()
  if (!r2) {
    return Response.json(
      { error: "El almacenamiento de archivos no está configurado. Avise al administrador." },
      { status: 503, headers: NO_STORE },
    )
  }

  let pdf: Uint8Array | null
  try {
    pdf = await r2.getObject(producto.fichaTecnica.key, { maxBytes: MAX_BYTES_FICHA })
  } catch (err) {
    console.error(`[admin/catalogo/ficha] tenant=${guard.tenantId} R2: ${err instanceof Error ? err.name : "error"}`)
    return Response.json({ error: "No se pudo obtener la ficha técnica. Inténtelo de nuevo." }, { status: 502, headers: NO_STORE })
  }
  if (!pdf) {
    return Response.json({ error: "No se encontró el archivo de la ficha técnica. Vuelva a subirlo." }, { status: 404, headers: NO_STORE })
  }

  const download = new URL(req.url).searchParams.get("download") === "1"
  const nombre = producto.fichaTecnica.nombre.replace(/[^\w.-]+/g, "-") || "ficha-tecnica.pdf"
  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${nombre}"`,
      "Cache-Control": "private, no-store",
    },
  })
}

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

  const body = (await req.json().catch(() => null)) as { nombre?: unknown; bytes?: unknown; sha256?: unknown } | null
  if (!body) return validacionResponse("El cuerpo del pedido no es JSON válido.", "body")

  const nombre = typeof body.nombre === "string" ? body.nombre.trim().slice(0, 200) : ""
  if (!nombre) return validacionResponse("Indique el archivo a subir.", "nombre")

  const bytes = Number(body.bytes)
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES_FICHA) {
    return validacionResponse(`El archivo no puede superar los ${MAX_BYTES_FICHA / 1024 / 1024} MB.`, "bytes")
  }

  let key: string
  try {
    if (body.sha256 !== undefined) {
      const sha = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : ""
      if (!SHA256_RE.test(sha)) return validacionResponse("No pudimos identificar el archivo.", "sha256")
      key = fichaContenidoKey(guard.tenantId, sha)
      // Mismo contenido ya en el bucket: no se vuelve a subir. Se informa el tamaño REAL del objeto.
      const existente = await r2.head(key)
      if (existente) {
        return Response.json({ key, existente: true, nombre, bytes: existente.size }, { headers: NO_STORE })
      }
    } else {
      key = fichaKey(guard.tenantId, alegraId, randomUUID())
    }
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

  return Response.json({ key, url, headers, nombre, bytes, existente: false }, { headers: NO_STORE })
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
  const sha = shaDeFichaContenidoKey(guard.tenantId, key)
  // Sin esta comprobación, un PUT podría hacer que el producto de un tenant apunte a la ficha de
  // otro: la key viene del navegador. Vale la key propia del producto o una por contenido del
  // MISMO tenant (el prefijo `productos/{tenant}/fichas/` no lo puede fabricar otro tenant).
  if ((!sha && !key.startsWith(prefijoDelTenant)) || key.includes("..")) {
    return validacionResponse("La ficha técnica no pertenece a este producto.", "key")
  }
  const nombre = typeof body.nombre === "string" ? body.nombre.trim().slice(0, 200) : ""
  if (!nombre) return validacionResponse("Indique el nombre del archivo.", "nombre")
  let bytes = Number(body.bytes)
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES_FICHA) {
    return validacionResponse("El archivo no es válido.", "bytes")
  }

  const r2 = getShopMediaR2()
  if (sha) {
    if (!r2) {
      return Response.json(
        { error: "El almacenamiento de archivos no está configurado. Avise al administrador." },
        { status: 503, headers: NO_STORE },
      )
    }
    const objeto = await r2.head(key)
    if (!objeto) return conflictoResponse("El archivo no llegó al almacenamiento. Vuelva a subirlo.", "sin_objeto")
    bytes = objeto.size
    // La key promete un contenido: si nadie la usa todavía, se comprueba que el archivo subido
    // sea de verdad el de ese sha256 (la key la fabricó el navegador). Si ya la usa otro
    // producto, ese contenido se verificó cuando se guardó y no hace falta bajarlo de nuevo.
    if ((await contarReferenciasFicha(guard.tenantId, key)) === 0) {
      const contenido = await r2.getObject(key, { maxBytes: MAX_BYTES_FICHA }).catch(() => null)
      if (!contenido || sha256Hex(contenido) !== sha) {
        await r2.delete(key).catch(() => {})
        return validacionResponse("El archivo subido no coincide con el esperado. Vuelva a subirlo.", "sha256")
      }
    }
  }

  const keyAnterior = anterior.fichaTecnica?.key ?? null
  const origenAnterior = anterior.fichaTecnica?.origen?.key ?? null
  await guardarOverlay(
    guard.tenantId,
    alegraId,
    { fichaTecnica: { key, nombre, bytes, ...(sha ? { sha256: sha } : {}) } },
    guard.user.id,
  )

  // Soltar lo anterior DESPUÉS de guardar la nueva (así una carga que fallara a mitad de camino
  // nunca deja al producto sin ninguna ficha en R2) y sólo si ningún otro producto lo usa.
  for (const vieja of new Set([keyAnterior, origenAnterior])) {
    if (vieja && vieja !== key) await borrarFichaSiHuerfana(guard.tenantId, vieja, r2)
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

  // Varios productos pueden compartir el mismo objeto: sólo se borra si ya nadie lo referencia.
  if (anterior.fichaTecnica) {
    const r2 = getShopMediaR2()
    for (const vieja of new Set([anterior.fichaTecnica.key, anterior.fichaTecnica.origen?.key])) {
      await borrarFichaSiHuerfana(guard.tenantId, vieja, r2)
    }
  }

  const producto = await detalleProducto(guard.tenantId, alegraId)
  if (!producto) return adminNotFoundResponse()

  await avisarShop(guard.tenantId)
  return Response.json({ producto: conUrlDeFicha(producto) }, { headers: NO_STORE })
}
