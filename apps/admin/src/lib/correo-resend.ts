// Cliente REST de Resend Inboxes (beta) para el correo compartido del CRM.
//
// Único módulo que habla con Resend por esta vía: fetch directo (sin el SDK preview), tipos
// propios y normalizadores tolerantes, porque la API beta avisa que su forma puede cambiar.
// Usa RESEND_API_KEY_EMAILS (distinta de RESEND_API_KEY, que es la del envío transaccional).
// La clave vive solo en el servidor: nunca va al browser ni a logs ni a mensajes de error.
//
// Límite de Resend: 10 req/s por team (compartido con OTP y cobranza). Mitigación acá: máx. 4
// requests en vuelo por instancia y reintento con backoff ante 429/5xx respetando Retry-After.

const BASE_URL = "https://api.resend.com"
const MAX_REINTENTOS = 3
const MAX_EN_VUELO = 4
const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 8000

export type CorreoCarpeta = "inbox" | "archive" | "spam" | "sent" | "trash"

export interface CorreoCasilla {
  id: string
  email: string
  nombre: string
}

export interface CorreoHilo {
  id: string
  asunto: string
  de: string
  para: string[]
  cc: string[]
  mensajes: number
  conAdjuntos: boolean
  leido: boolean
  recibidoEn: string
}

export interface CorreoAdjunto {
  id: string
  nombre: string
  tamano: number
  tipo: string
}

export interface CorreoMensaje {
  id: string
  direccion: "inbound" | "outbound"
  de: string
  para: string[]
  cc: string[]
  replyTo: string[]
  asunto: string
  messageId: string | null
  leido: boolean
  recibidoEn: string
  adjuntos: CorreoAdjunto[]
  adjuntosCount: number
}

export interface CorreoMensajeConCuerpo extends CorreoMensaje {
  html: string | null
  texto: string | null
}

export interface CorreoPaginaHilos {
  hilos: CorreoHilo[]
  hasMore: boolean
  /** Id del último hilo de la página: se pasa como `after` para pedir la siguiente. */
  siguiente: string | null
}

export interface CorreoHiloDetalle {
  id: string
  asunto: string
  carpeta: CorreoCarpeta | null
  leido: boolean
  mensajes: CorreoMensaje[]
}

export interface CorreoEnvioPayload {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  html?: string
  text?: string
  headers?: Record<string, string>
  attachments?: { filename: string; path?: string; content?: string }[]
}

export type CorreoErrorCode =
  | "no_configurado"
  | "no_autorizado"
  | "prohibido"
  | "no_encontrado"
  | "invalido"
  | "limite"
  | "servidor"
  | "red"

const MENSAJES: Record<CorreoErrorCode, string> = {
  no_configurado: "El correo no está configurado.",
  no_autorizado: "No se pudo autenticar el servicio de correo.",
  prohibido: "El servicio de correo no permite esta operación.",
  no_encontrado: "No se encontró lo solicitado.",
  invalido: "El servicio de correo rechazó la solicitud. Revise los datos ingresados.",
  limite: "Inténtelo nuevamente en unos instantes.",
  servidor: "El servicio de correo no está disponible. Inténtelo nuevamente en unos instantes.",
  red: "No se pudo conectar con el servicio de correo. Inténtelo nuevamente.",
}

export class CorreoResendError extends Error {
  readonly status: number
  readonly code: CorreoErrorCode
  readonly retryAfter: number | null
  constructor(code: CorreoErrorCode, status = 0, retryAfter: number | null = null) {
    super(MENSAJES[code])
    this.name = "CorreoResendError"
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
  }
}

/** Ganchos para tests (espera sin esperar de verdad). */
export const _internos = {
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
}

function codigoDeStatus(status: number): CorreoErrorCode {
  if (status === 401) return "no_autorizado"
  if (status === 403) return "prohibido"
  if (status === 404) return "no_encontrado"
  if (status === 429) return "limite"
  if (status >= 500) return "servidor"
  return "invalido"
}

// Semáforo simple por instancia: máx. MAX_EN_VUELO requests simultáneos.
let enVuelo = 0
const cola: (() => void)[] = []
async function adquirir(): Promise<void> {
  if (enVuelo < MAX_EN_VUELO) {
    enVuelo++
    return
  }
  await new Promise<void>((resolve) => cola.push(resolve))
}
function liberar(): void {
  const siguiente = cola.shift()
  if (siguiente) siguiente()
  else enVuelo--
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null
  const n = Number(h)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function esperaMs(intento: number, retryAfter: number | null): number {
  const backoff = Math.min(BACKOFF_BASE_MS * 2 ** intento, BACKOFF_MAX_MS)
  return retryAfter != null ? Math.max(retryAfter * 1000, backoff) : backoff
}

async function pedir(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
  const clave = process.env.RESEND_API_KEY_EMAILS
  if (!clave) throw new CorreoResendError("no_configurado")

  let ultimo: CorreoResendError | null = null
  for (let intento = 0; intento <= MAX_REINTENTOS; intento++) {
    let res: Response | null = null
    await adquirir()
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${clave}`,
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      })
    } catch {
      ultimo = new CorreoResendError("red")
    } finally {
      liberar()
    }

    if (res) {
      if (res.ok) {
        try {
          return await res.json()
        } catch {
          return {}
        }
      }
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"))
      ultimo = new CorreoResendError(codigoDeStatus(res.status), res.status, retryAfter)
      if (res.status !== 429 && res.status < 500) throw ultimo
    }

    if (intento < MAX_REINTENTOS) await _internos.sleep(esperaMs(intento, ultimo?.retryAfter ?? null))
  }
  throw ultimo ?? new CorreoResendError("red")
}

// ---------------------------------------------------------------- normalizadores

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {})
const str = (v: unknown, def = ""): string => (typeof v === "string" ? v : def)
const num = (v: unknown, def = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : def)
const bool = (v: unknown, def = false): boolean => (typeof v === "boolean" ? v : def)
const lista = (v: unknown): string[] => {
  if (typeof v === "string") return v ? [v] : []
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
}
const filas = (v: unknown): Obj[] => {
  const data = Array.isArray(v) ? v : obj(v).data
  return Array.isArray(data) ? data.map(obj) : []
}

const CARPETAS: CorreoCarpeta[] = ["inbox", "archive", "spam", "sent", "trash"]
const carpeta = (v: unknown): CorreoCarpeta | null => (CARPETAS.includes(v as CorreoCarpeta) ? (v as CorreoCarpeta) : null)

function normHilo(r: Obj): CorreoHilo {
  return {
    id: str(r.id),
    asunto: str(r.subject),
    de: str(r.from),
    para: lista(r.to),
    cc: lista(r.cc),
    mensajes: num(r.message_count, 1),
    conAdjuntos: bool(r.has_attachment),
    leido: bool(r.read, true),
    recibidoEn: str(r.received_at),
  }
}

function normAdjunto(r: Obj): CorreoAdjunto {
  return {
    id: str(r.id),
    nombre: str(r.filename, "adjunto"),
    tamano: num(r.size),
    tipo: str(r.content_type, "application/octet-stream"),
  }
}

function normMensaje(r: Obj): CorreoMensaje {
  const adjuntos = filas(r.attachments).map(normAdjunto)
  return {
    id: str(r.id),
    direccion: r.direction === "outbound" ? "outbound" : "inbound",
    de: str(r.from),
    para: lista(r.to),
    cc: lista(r.cc),
    replyTo: lista(r.reply_to),
    asunto: str(r.subject),
    messageId: str(r.message_id) || null,
    leido: bool(r.read, true),
    recibidoEn: str(r.received_at),
    adjuntos,
    adjuntosCount: adjuntos.length || num(r.attachments_count),
  }
}

const seg = encodeURIComponent

// ---------------------------------------------------------------- operaciones

export async function listInboxes(): Promise<CorreoCasilla[]> {
  const r = await pedir("GET", "/inboxes")
  return filas(r).map((i) => ({ id: str(i.id), email: str(i.email_address) || str(i.address) || str(i.email), nombre: str(i.name) }))
}

export async function listThreads(
  inboxId: string,
  opts: { folder?: CorreoCarpeta; q?: string; after?: string; limit?: number } = {},
): Promise<CorreoPaginaHilos> {
  const qs = new URLSearchParams()
  if (opts.folder) qs.set("folder", opts.folder)
  if (opts.q) qs.set("query", opts.q)
  if (opts.after) qs.set("after", opts.after)
  if (opts.limit) qs.set("limit", String(opts.limit))
  const sufijo = qs.size ? `?${qs}` : ""
  const r = await pedir("GET", `/inboxes/${seg(inboxId)}/threads${sufijo}`)
  const hilos = filas(r).map(normHilo)
  return { hilos, hasMore: bool(obj(r).has_more), siguiente: hilos.at(-1)?.id ?? null }
}

export async function listThreadEmails(inboxId: string, threadId: string): Promise<CorreoHiloDetalle> {
  // El hilo (asunto, carpeta, leído) y sus mensajes son dos endpoints distintos de Resend:
  // GET /threads/{id} no trae los emails. La lista de mensajes sí trae html/text completos de
  // cada uno; normMensaje los descarta (los cuerpos se piden de a uno con getThreadEmail).
  const base = `/inboxes/${seg(inboxId)}/threads/${seg(threadId)}`
  const [hilo, emails] = await Promise.all([pedir("GET", base), pedir("GET", `${base}/emails`)])
  const r = obj(hilo)
  return {
    id: str(r.id, threadId),
    asunto: str(r.subject),
    carpeta: carpeta(r.folder),
    leido: bool(r.read, true),
    mensajes: filas(emails).map(normMensaje),
  }
}

export async function getThreadEmail(inboxId: string, threadId: string, emailId: string): Promise<CorreoMensajeConCuerpo> {
  const r = obj(await pedir("GET", `/inboxes/${seg(inboxId)}/threads/${seg(threadId)}/emails/${seg(emailId)}`))
  return { ...normMensaje(r), html: str(r.html) || null, texto: str(r.text) || null }
}

export async function patchThread(
  inboxId: string,
  threadId: string,
  cambios: { read?: boolean; folder?: Exclude<CorreoCarpeta, "sent"> },
): Promise<void> {
  await pedir("PATCH", `/inboxes/${seg(inboxId)}/threads/${seg(threadId)}`, cambios)
}

export async function listReceivedAttachments(emailId: string): Promise<CorreoAdjunto[]> {
  const r = await pedir("GET", `/emails/receiving/${seg(emailId)}/attachments`)
  return filas(r).map(normAdjunto)
}

/** URL firmada y vencible (~1 h): se resuelve en el momento de la descarga, nunca se persiste. */
export async function getAttachmentDownloadUrl(
  emailId: string,
  attachmentId: string,
): Promise<{ url: string; nombre: string; tamano: number; tipo: string }> {
  const r = obj(await pedir("GET", `/emails/receiving/${seg(emailId)}/attachments/${seg(attachmentId)}`))
  const a = normAdjunto(r)
  const url = str(r.download_url)
  if (!url) throw new CorreoResendError("no_encontrado", 404)
  return { url, nombre: a.nombre, tamano: a.tamano, tipo: a.tipo }
}

/**
 * Envía por POST /emails (único camino que conserva los adjuntos). Siempre con Idempotency-Key:
 * el mismo valor se reusa en los reintentos por 5xx/429 y en un reenvío de la misma intención,
 * así un doble clic o un corte de red no duplica el mail.
 */
export async function sendEmail(payload: CorreoEnvioPayload, opts: { idempotencyKey?: string } = {}): Promise<{ id: string }> {
  const clave = opts.idempotencyKey || crypto.randomUUID()
  const r = obj(await pedir("POST", "/emails", payload, { "Idempotency-Key": clave }))
  return { id: str(r.id) }
}
