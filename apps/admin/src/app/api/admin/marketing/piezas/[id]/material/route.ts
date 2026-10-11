import { randomUUID } from "crypto"
import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { ESTADOS_CON_MATERIAL } from "@/lib/marketing/estados"
import { esKeyDeMaterial, materialKey, tipoMaterial, type TipoMaterial } from "@/lib/marketing/material-keys"
import { registrarMaterial } from "@/lib/marketing/otros-repo"
import { obtenerPieza } from "@/lib/marketing/piezas-repo"
import { pingStudio } from "@/lib/marketing/ping-studio"
import { getShopMediaR2 } from "@/lib/shop-media"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ id: string }> }

function invalido(error: string, code: string): Response {
  return Response.json({ error, code }, { status: 400, headers: NO_STORE })
}

function conflicto(error: string, code: string): Response {
  return Response.json({ error, code }, { status: 409, headers: NO_STORE })
}

const SIN_MATERIAL = () => conflicto("Esta pieza ya no admite material", "invalid_state")

const SIN_ALMACENAMIENTO = () =>
  Response.json({ error: "El almacenamiento de archivos no está configurado", code: "storage_not_configured" }, { status: 503, headers: NO_STORE })

function validarArchivo(b: { contentType?: unknown; bytes?: unknown } | null): { contentType: string; bytes: number; tipo: TipoMaterial } | Response {
  const contentType = typeof b?.contentType === "string" ? b.contentType : ""
  const tipo = tipoMaterial(contentType)
  if (!tipo) return invalido("Formato no admitido. Suba un video MP4 o MOV, o una foto JPG, PNG o WEBP", "invalid_tipo")
  const bytes = b?.bytes
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) return invalido("Indique un tamaño de archivo válido", "invalid_bytes")
  if (bytes > tipo.maxBytes) return invalido("El archivo supera el tamaño máximo permitido", "invalid_bytes")
  return { contentType, bytes, tipo }
}

/** Camina la cadena de `cause` buscando el 23505 (unique_violation) de Postgres. */
function esUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "23505") return true
  }
  return false
}

// Paso 1: firma una URL PUT para que el navegador suba directo a R2.
export async function POST(req: Request, ctx: Ctx) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  const pieza = await obtenerPieza(guard.tenantId, id)
  if (!pieza) return adminNotFoundResponse()
  if (!(ESTADOS_CON_MATERIAL as readonly string[]).includes(pieza.estado)) return SIN_MATERIAL()
  const archivo = validarArchivo(await req.json().catch(() => null))
  if (archivo instanceof Response) return archivo
  const r2 = getShopMediaR2()
  if (!r2) return SIN_ALMACENAMIENTO()
  const key = materialKey(guard.tenantId, id, randomUUID(), archivo.contentType)
  const firmado = await r2.presignPut(key, { contentType: archivo.contentType, contentLength: archivo.bytes, ttlSeconds: 900 })
  return Response.json({ key, url: firmado.url, headers: firmado.headers }, { headers: NO_STORE })
}

// Paso 2: confirma la subida y registra el material (la pieza que lo esperaba pasa a borrador).
export async function PUT(req: Request, ctx: Ctx) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  const pieza = await obtenerPieza(guard.tenantId, id)
  if (!pieza) return adminNotFoundResponse()
  if (!(ESTADOS_CON_MATERIAL as readonly string[]).includes(pieza.estado)) return SIN_MATERIAL()
  const b = (await req.json().catch(() => null)) as { key?: unknown; contentType?: unknown; bytes?: unknown } | null
  const archivo = validarArchivo(b)
  if (archivo instanceof Response) return archivo
  const key = String(b?.key ?? "")
  if (!esKeyDeMaterial(guard.tenantId, id, key)) return invalido("El archivo no corresponde a esta pieza", "invalid_key")
  const r2 = getShopMediaR2()
  if (!r2) return SIN_ALMACENAMIENTO()
  // El navegador declara tipo y tamaño: se contrastan con lo que realmente quedó en el bucket.
  const subido = await r2.head(key)
  if (!subido) return invalido("No se encontró el archivo subido. Vuelva a subirlo", "not_uploaded")
  const extDeclarada = archivo.tipo.ext
  if (subido.size !== archivo.bytes || (subido.contentType && subido.contentType !== archivo.contentType) || !key.endsWith(`.${extDeclarada}`)) {
    return invalido("El archivo subido no coincide con lo declarado", "mismatch")
  }
  let m
  try {
    m = await registrarMaterial(guard.tenantId, {
      piezaId: id,
      archivoKey: key,
      tipo: archivo.tipo.tipo,
      contentType: archivo.contentType,
      bytes: archivo.bytes,
      subidoPor: guard.user.id,
    })
  } catch (err) {
    if (esUniqueViolation(err)) return conflicto("Este archivo ya fue registrado", "duplicate")
    throw err
  }
  await pingStudio()
  return Response.json(m, { status: 201, headers: NO_STORE })
}
