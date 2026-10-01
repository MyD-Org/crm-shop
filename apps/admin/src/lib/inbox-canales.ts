import { channelLabel, type InboxContact } from "@/lib/inbox-api"

// Solapas del inbox por canal de entrada (un número de WhatsApp por sucursal, Instagram...).
// Lógica pura: agrupar, rotular y contar. Los nombres que define el admin viven en la tabla
// `inbox_canales` (clave = channel_account_id) y llegan acá como un mapa clave → nombre.

export const CANAL_TODAS = "all"
export const NOMBRE_MAX = 60
const PREFIJO_SIN_CUENTA = "canal:"

export type CanalContacto = Pick<InboxContact, "channel" | "channel_account_id" | "business_phone" | "awaiting_reply">

export interface CanalTab {
  key: string
  label: string
  /** Contactos del canal que esperan respuesta. */
  pending: number
}

/** Clave estable del canal: la cuenta si existe; si no, el canal (p. ej. "canal:instagram"). */
export function canalKey(c: Pick<InboxContact, "channel" | "channel_account_id">): string {
  return c.channel_account_id || `${PREFIJO_SIN_CUENTA}${c.channel || "desconocido"}`
}

/** Nombre del admin, si no el teléfono del negocio, si no el nombre del canal. */
export function canalLabel(
  key: string,
  nombres: Record<string, string>,
  fallback: { business_phone?: string | null; channel: string },
): string {
  return nombres[key]?.trim() || fallback.business_phone?.trim() || channelLabel(fallback.channel)
}

/** Una solapa por canal presente en los contactos, en orden de aparición. */
export function buildCanalTabs(contacts: CanalContacto[], nombres: Record<string, string>): CanalTab[] {
  const tabs = new Map<string, CanalTab & { phone: string | null; channel: string }>()
  for (const c of contacts) {
    const key = canalKey(c)
    const t = tabs.get(key) ?? { key, label: "", pending: 0, phone: null, channel: c.channel }
    if (!t.phone && c.business_phone) t.phone = c.business_phone
    if (c.awaiting_reply) t.pending++
    tabs.set(key, t)
  }
  return [...tabs.values()].map((t) => ({
    key: t.key,
    pending: t.pending,
    label: canalLabel(t.key, nombres, { business_phone: t.phone, channel: t.channel }),
  }))
}

export function filterByCanal<T extends Pick<InboxContact, "channel" | "channel_account_id">>(
  contacts: T[],
  selected: string,
): T[] {
  if (selected === CANAL_TODAS) return contacts
  return contacts.filter((c) => canalKey(c) === selected)
}

/** La selección guardada solo vale si ese canal sigue existiendo; si no, "Todas". */
export function resolveSelected(selected: string, tabs: CanalTab[]): string {
  return tabs.some((t) => t.key === selected) ? selected : CANAL_TODAS
}

export interface CanalEditable {
  key: string
  /** Referencia para el admin cuando todavía no hay nombre (teléfono o canal). */
  referencia: string
}

/** Respuesta de ai-api GET /v1/staff/whatsapp-numbers, leída con tolerancia al formato. */
export function parseWhatsappNumbers(raw: unknown): { id: string; phone: string | null }[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { numbers?: unknown }).numbers)
      ? (raw as { numbers: unknown[] }).numbers
      : []
  const out: { id: string; phone: string | null }[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const id = [o.channel_account_id, o.id].find((v) => typeof v === "string" && v)
    if (typeof id !== "string") continue
    const phone = [o.business_phone, o.display_phone_number, o.phone].find((v) => typeof v === "string" && v)
    out.push({ id, phone: typeof phone === "string" ? phone : null })
  }
  return out
}

/** Canales a nombrar: los números de WhatsApp de ai-api más los que aparecen en los contactos. */
export function canalesEditables(
  contacts: CanalContacto[],
  numeros: { id: string; phone: string | null }[],
): CanalEditable[] {
  const map = new Map<string, CanalEditable>()
  for (const n of numeros) map.set(n.id, { key: n.id, referencia: n.phone ?? channelLabel("whatsapp") })
  for (const c of contacts) {
    const key = canalKey(c)
    const prev = map.get(key)
    if (!prev) map.set(key, { key, referencia: c.business_phone || channelLabel(c.channel) })
    else if (c.business_phone && prev.referencia === channelLabel("whatsapp")) prev.referencia = c.business_phone
  }
  return [...map.values()]
}

const SELECCION_KEY = "inbox-canal"

export function leerSeleccion(): string {
  try {
    return window.localStorage.getItem(SELECCION_KEY) || CANAL_TODAS
  } catch {
    return CANAL_TODAS
  }
}

export function guardarSeleccion(key: string): void {
  try {
    window.localStorage.setItem(SELECCION_KEY, key)
  } catch {
    // Sin storage (modo privado, bloqueado): la solapa vale solo para esta sesión.
  }
}

/** Valida el body del PUT: {nombres: {clave: nombre}}. Nombre vacío = quitar el nombre. */
export function parseNombresBody(
  body: unknown,
): { ok: true; nombres: Record<string, string> } | { ok: false; error: string } {
  const raw = body && typeof body === "object" ? (body as { nombres?: unknown }).nombres : null
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Indique los nombres de los canales." }
  }
  const nombres: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!k || k.length > 200 || typeof v !== "string") return { ok: false, error: "Los nombres de los canales no son válidos." }
    const nombre = v.trim()
    if (nombre.length > NOMBRE_MAX) return { ok: false, error: `El nombre no puede superar los ${NOMBRE_MAX} caracteres.` }
    nombres[k] = nombre
  }
  return { ok: true, nombres }
}
