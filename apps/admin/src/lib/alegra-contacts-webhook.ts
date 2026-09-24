import { createHmac } from "node:crypto"
import type { TenantConfig } from "./tenants"
import { AlegraHttpError, AlegraRateLimitError, getContactRaw, mapRawContactRow } from "./alegra"
import { darDeBajaContacto, upsertContactos } from "./alegra-contacts-repo"
import { secureCompare } from "./secure-compare"

// Avisos (webhooks) de Alegra sobre contactos → espejo (tabla alegra_contacts). Con esto el
// espejo se entera de un alta, una edición o una baja en segundos, gastando 0 o 1 request, y
// la sync completa por tramos queda como control semanal.
//
// Lo que NO se sabe todavía (la doc de Alegra no lo dice): qué trae el cuerpo del aviso y si
// viene firmado. Por eso:
// - Autenticación: token secreto en la URL, uno por tenant, derivado con HMAC de
//   ALEGRA_WEBHOOK_SECRET (sin tabla ni migración: se recalcula igual en la ruta y en el
//   script que crea las suscripciones). Se compara en tiempo constante.
// - Evento: va en la URL (una suscripción por evento), así no depende del formato del cuerpo.
// - Cuerpo: se lee a la defensiva. Si trae el contacto completo, upsert directo; si trae solo
//   el id (o una forma que no se reconoce), se lee el contacto por id (1 request).
//   `delete-client` = baja soft, sin request (si el id no es inequívocamente el del contacto,
//   se confirma con 1 request: una baja equivocada es peor que gastar una).
// - Logs: tenant, evento, acción e id. NUNCA valores del cuerpo (nombres, CUIT, emails). La
//   primera vez por (tenant, evento) y por instancia se loguean las CLAVES del cuerpo, sin
//   valores, para descubrir el formato.

export const EVENTOS_CONTACTOS = ["new-client", "edit-client", "delete-client"] as const
export type EventoContacto = (typeof EVENTOS_CONTACTOS)[number]

export function esEventoContacto(x: string): x is EventoContacto {
  return (EVENTOS_CONTACTOS as readonly string[]).includes(x)
}

/** Largo mínimo del secreto: uno corto se adivina y abre la escritura del espejo. */
const SECRETO_MIN = 32

/**
 * Token de la URL de los avisos de un tenant: HMAC-SHA256(ALEGRA_WEBHOOK_SECRET,
 * "alegra-contactos:<tenant>") en hex, 32 caracteres. `null` si el secreto no está configurado o es
 * corto: sin secreto la ruta rechaza todo (falla cerrada).
 */
export function tokenWebhookContactos(
  tenantId: string,
  secreto: string | undefined = process.env.ALEGRA_WEBHOOK_SECRET,
): string | null {
  if (!secreto || secreto.length < SECRETO_MIN) return null
  // Hex y 32 caracteres (128 bits): Alegra rechaza la URL de la suscripción con "La URL
  // ingresada no es válida" con el token en base64url (trae "_" y "-"). Probado 2026-09-23.
  return createHmac("sha256", secreto).update(`alegra-contactos:${tenantId}`).digest("hex").slice(0, 32)
}

export function tokenWebhookValido(
  tenantId: string,
  token: string,
  secreto: string | undefined = process.env.ALEGRA_WEBHOOK_SECRET,
): boolean {
  const esperado = tokenWebhookContactos(tenantId, secreto)
  if (!esperado || !token) return false
  return secureCompare(token, esperado)
}

/** Ruta pública de los avisos (sin el host). La usan la ruta y el script de suscripciones. */
export function rutaWebhookContactos(tenantId: string, evento: EventoContacto, token: string): string {
  return `/api/webhooks/alegra/contactos/${encodeURIComponent(tenantId)}/${evento}/${token}`
}

// ── Lectura defensiva del cuerpo ──

type Obj = Record<string, unknown>

function objeto(v: unknown): Obj | null {
  if (typeof v === "string") {
    // Hay integraciones que mandan el objeto como texto JSON dentro del cuerpo.
    const t = v.trim()
    if (!t.startsWith("{")) return null
    try {
      return objeto(JSON.parse(t))
    } catch {
      return null
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null
}

/** Ids de Alegra son numéricos; se acepta algo razonable y nada que pueda romper una URL. */
function idDe(o: Obj | null): string | null {
  const v = o?.id
  const id = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : ""
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

/**
 * ¿Es un contacto como el que devuelve `GET /contacts/{id}`? Se exige lo mínimo que distingue
 * un contacto completo de un aviso con solo el id: nombre, tipo y estado. Uno parcial NO se
 * upsertea directo: pisaría con null lo que no trajo.
 */
function esContactoCompleto(o: Obj): boolean {
  return typeof o.name === "string" && o.name.trim() !== "" && "type" in o && "status" in o
}

export interface AvisoContacto {
  id: string | null
  /** El contacto completo si vino en el cuerpo; si no, `null` y hay que leerlo por id. */
  contacto: Obj | null
  /**
   * El id salió de una clave que nombra al contacto (`client`/`contact`) o de un objeto que es
   * un contacto completo. Si no (un `id` suelto en la raíz podría ser el del aviso y no el del
   * contacto), una baja se confirma leyendo el contacto antes de marcarlo.
   */
  idSeguro: boolean
}

/** Busca el contacto (o al menos su id) en las formas razonables de un aviso. */
export function leerAvisoContacto(payload: unknown): AvisoContacto {
  const raiz = objeto(payload)
  if (!raiz) return { id: null, contacto: null, idSeguro: false }
  const message = objeto(raiz.message)
  const data = objeto(raiz.data)
  const nombrados = [
    objeto(message?.client),
    objeto(message?.contact),
    objeto(raiz.client),
    objeto(raiz.contact),
    objeto(data?.client),
    objeto(data?.contact),
  ]
  for (const c of nombrados) {
    const id = idDe(c)
    if (c && id) return { id, contacto: esContactoCompleto(c) ? c : null, idSeguro: true }
  }
  for (const c of [data, message, raiz]) {
    const id = idDe(c)
    if (c && id) {
      const completo = esContactoCompleto(c)
      return { id, contacto: completo ? c : null, idSeguro: completo }
    }
  }
  return { id: null, contacto: null, idSeguro: false }
}

/**
 * Claves del cuerpo SIN valores: las de primer nivel y, para las que son objeto, las de
 * adentro ("message.client"). Sirve para descubrir el formato sin loguear datos personales.
 */
export function clavesDelPayload(payload: unknown): string[] {
  const raiz = objeto(payload)
  if (!raiz) return [Array.isArray(payload) ? "(lista)" : `(${typeof payload})`]
  const out: string[] = []
  for (const [k, v] of Object.entries(raiz)) {
    const hijo = objeto(v)
    out.push(hijo ? `${k}{${Object.keys(hijo).join(",")}}` : k)
  }
  return out
}

const clavesYaLogueadas = new Set<string>()

/** Loguea las claves del cuerpo la primera vez por (tenant, evento) en esta instancia. */
export function loguearClavesUnaVez(tenantId: string, evento: EventoContacto, payload: unknown): void {
  const k = `${tenantId}:${evento}`
  if (clavesYaLogueadas.has(k)) return
  clavesYaLogueadas.add(k)
  console.log(`[webhooks/alegra] tenant=${tenantId} evento=${evento} claves=${clavesDelPayload(payload).join(" ")}`)
}

// ── Aplicar el aviso al espejo ──

export type AccionAviso = "upsert_directo" | "upsert_leido" | "baja" | "baja_404" | "sin_id" | "error"

export interface ResultadoAviso {
  accion: AccionAviso
  id?: string
  /** Motivo técnico corto (tipo/status), nunca el mensaje de Alegra. */
  error?: string
  /** Requests a Alegra que gastó (0 o 1, más reintentos por 429). */
  requests: number
}

function motivo(err: unknown): string {
  if (err instanceof AlegraRateLimitError) return "alegra_429"
  if (err instanceof AlegraHttpError) return `alegra_http_${err.status}`
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `db_${code}`
  return "error_interno"
}

/**
 * Pocos reintentos: el aviso corre después de responder, dentro del maxDuration de la ruta,
 * y el cupo de /contacts lo comparten el portal y el bot. Si igual no alcanza, lo corrige la
 * sync semanal (o el fallback por id la próxima vez que alguien lea ese contacto).
 */
const REINTENTOS_429 = 2

/** Aplica un aviso al espejo. Nunca tira: todo termina en el resultado. */
export async function procesarAvisoContacto(
  config: TenantConfig,
  evento: EventoContacto,
  payload: unknown,
): Promise<ResultadoAviso> {
  const { id, contacto, idSeguro } = leerAvisoContacto(payload)
  if (!id) return { accion: "sin_id", requests: 0 }
  let requests = 0
  try {
    if (evento === "delete-client" && idSeguro) {
      await darDeBajaContacto(config.id, id)
      return { accion: "baja", id, requests }
    }
    if (contacto && evento !== "delete-client") {
      await upsertContactos(config.id, [mapRawContactRow(contacto)], "webhook")
      return { accion: "upsert_directo", id, requests }
    }
    requests++
    const raw = await getContactRaw(config, id, { reintentos429: REINTENTOS_429 })
    if (!raw) {
      // Baja confirmada, o avisó un alta/edición de algo que ya no existe (lo borraron enseguida).
      await darDeBajaContacto(config.id, id)
      return { accion: "baja_404", id, requests }
    }
    await upsertContactos(config.id, [mapRawContactRow(raw)], "webhook")
    return { accion: "upsert_leido", id, requests }
  } catch (err) {
    return { accion: "error", id, error: motivo(err), requests }
  }
}
