import { createHmac } from "node:crypto"
import { secureCompare } from "./secure-compare"
import type { CorreoCarpeta } from "./correo-resend"

// Webhook de Resend Inboxes (beta): verificación de firma svix y parseo puro de eventos.
// Sin red ni base. La ruta (app/api/webhooks/resend-inboxes) orquesta idempotencia y efectos.
// Los payloads reales pueden cambiar ("shape might change"): el parseo es tolerante y descarta
// lo que no reconoce en vez de lanzar.

/** Tolerancia del timestamp de svix (segundos), en ambos sentidos. */
export const TOLERANCIA_SEGUNDOS = 5 * 60

interface VerificarFirmaArgs {
  id: string | null
  timestamp: string | null
  signature: string | null
  /** Cuerpo CRUDO tal como llegó (la firma se calcula sobre estos bytes). */
  rawBody: string
  /** Signing secret de Resend (`whsec_<base64>` o el base64 pelado). */
  secret: string | undefined
  now?: Date
}

/**
 * Verificación svix a mano: HMAC-SHA256 en base64 sobre `${id}.${timestamp}.${rawBody}` con la
 * clave = secreto decodificado de base64 (sin `whsec_`). `svix-signature` trae una o más firmas
 * "v1,<base64>" separadas por espacio; basta que una coincida (rotación de secretos). Compara en
 * tiempo constante. Sin secreto configurado devuelve false (falla cerrada).
 */
export function verificarFirmaSvix({ id, timestamp, signature, rawBody, secret, now = new Date() }: VerificarFirmaArgs): boolean {
  if (!secret || !id || !timestamp || !signature) return false
  const base64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret
  if (!base64) return false
  const clave = Buffer.from(base64, "base64")
  if (clave.length === 0) return false

  if (!/^\d+$/.test(timestamp)) return false
  const dif = Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp))
  if (dif > TOLERANCIA_SEGUNDOS) return false

  const esperada = createHmac("sha256", clave).update(`${id}.${timestamp}.${rawBody}`).digest("base64")
  let ok = false
  for (const parte of signature.split(" ")) {
    const [version, valor] = parte.split(",")
    // No cortar en la primera coincidencia: mismo trabajo se haya acertado o no.
    if (version === "v1" && valor && secureCompare(valor, esperada)) ok = true
  }
  return ok
}

// ── Parseo de eventos ────────────────────────────────────────────────────────

export type TipoEventoCorreo = "email_recibido" | "hilo_creado" | "carpeta" | "email_enviado"

export interface EventoCorreo {
  tipo: TipoEventoCorreo
  inboxId: string
  threadId: string
  direccion: "inbound" | "outbound" | null
  /** Carpeta del hilo si el evento la informa y es conocida; null si no. */
  carpeta: CorreoCarpeta | null
  /** Estado leído del hilo; null si el evento no lo informa. Un correo recibido siempre es no leído. */
  leido: boolean | null
  /** Asunto, solo para armar el aviso push. NO se persiste. */
  asunto: string | null
  ocurridoAt: Date
}

const CARPETAS: readonly string[] = ["inbox", "archive", "spam", "sent", "trash"]

// Nombre (sin el prefijo opcional "inbox.") → tipo. "email.received" sin prefijo también es el
// evento de recepción de DOMINIO de Resend: se distingue porque ése no trae inbox_id/thread_id.
const TIPOS: Record<string, TipoEventoCorreo> = {
  "email.received": "email_recibido",
  "thread.created": "hilo_creado",
  "thread.folder.updated": "carpeta",
  "email.sent": "email_enviado",
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null
}

function carpetaDe(v: unknown): CorreoCarpeta | null {
  return typeof v === "string" && CARPETAS.includes(v) ? (v as CorreoCarpeta) : null
}

/** Convierte el JSON del webhook en un evento propio, o null si no es uno que procesemos. */
export function parsearEventoCorreo(body: unknown): EventoCorreo | null {
  const raiz = obj(body)
  if (!raiz) return null
  const nombre = str(raiz.type)
  if (!nombre) return null
  const tipo = TIPOS[nombre.replace(/^inbox\./, "")]
  if (!tipo) return null

  const data = obj(raiz.data)
  const inboxId = str(data?.inbox_id)
  const threadId = str(data?.thread_id) ?? str(obj(data?.thread)?.id)
  if (!data || !inboxId || !threadId) return null

  const thread = obj(data.thread)
  const email = obj(data.email)
  const dir = email?.direction
  const direccion = dir === "inbound" || dir === "outbound" ? dir : null

  const creado = typeof raiz.created_at === "string" ? new Date(raiz.created_at) : null
  const ocurridoAt = creado && !Number.isNaN(creado.getTime()) ? creado : new Date()

  // Carpeta: en "carpeta" manda el destino ("to"); en el resto, la del hilo. Recibidos sin dato = inbox.
  const carpeta = (tipo === "carpeta" ? carpetaDe(data.to) : null) ?? carpetaDe(thread?.folder) ?? (tipo === "email_recibido" ? "inbox" : null)
  const leido = tipo === "email_recibido" ? false : typeof thread?.read === "boolean" ? thread.read : null

  return { tipo, inboxId, threadId, direccion, carpeta, leido, asunto: str(thread?.subject) ?? str(email?.subject), ocurridoAt }
}
