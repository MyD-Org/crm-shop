import { randomUUID } from "node:crypto"
import { NO_STORE, errorJson } from "@/lib/correo-admin"
import { MAX_MAIL_BYTES } from "@/lib/correo-compose"
import { parseSubidaBody } from "@/lib/correo-envio-body"
import { requireCorreoLector } from "@/lib/correo-lectura"
import { correoKeys, getR2 } from "@/lib/r2"

const TTL_FIRMA_S = 600
// El base64 agranda lo adjunto ~37 %: un archivo que solo ya no entra en 40 MB no se sube.
const FACTOR_BASE64 = 1.37

// POST /api/admin/correo/adjuntos/subida — firma la subida de un adjunto del mail saliente.
//
// El archivo NO pasa por el servidor (una función de Vercel no recibe más de 4,5 MB de cuerpo): el
// navegador sube directo a R2 con la URL PUT prefirmada, bajo correo/tmp/{tenant}/{uuid}/. Al
// enviar, el servidor genera una URL GET corta y Resend baja el archivo desde ahí. Contenido y
// tamaño van DENTRO de la firma: la URL no sirve para subir otra cosa ni un archivo más grande.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const casillaId = typeof (body as { casillaId?: unknown } | null)?.casillaId === "string" ? (body as { casillaId: string }).casillaId : ""
  const guard = await requireCorreoLector(req, casillaId)
  if (!guard.ok) return guard.response

  const parsed = parseSubidaBody(body)
  if (!parsed.ok) return errorJson(parsed.error, 400)
  const { nombre, tamano, tipo } = parsed.valor
  if (tamano * FACTOR_BASE64 > MAX_MAIL_BYTES) return errorJson("El archivo supera el máximo de 40 MB.", 400, "demasiado_grande")

  const r2 = getR2()
  if (!r2) return errorJson("El almacenamiento de adjuntos no está configurado. Avise al administrador.", 503, "no_configurado")

  const key = correoKeys.tmp(guard.tenantId, randomUUID(), nombre)
  const { url, headers } = await r2.presignPut(key, { contentType: tipo, contentLength: tamano, ttlSeconds: TTL_FIRMA_S })
  return Response.json({ key, putUrl: url, headers }, { headers: NO_STORE })
}
