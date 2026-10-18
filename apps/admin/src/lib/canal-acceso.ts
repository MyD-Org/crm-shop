import { channelLabel } from "@/lib/inbox-api"
import { canalesEditables, type CanalContacto } from "@/lib/inbox-canales"

// Quién puede ver qué canal de entrada del inbox (un número de WhatsApp por sucursal, Instagram...).
// Es la ÚNICA política: toda superficie del inbox la usa, nunca se re-implementa en una ruta.
//
// Modelo (admin_users.canales_permitidos, 0092):
//   - NULL           → todos los canales (valor de todos los usuarios al migrar).
//   - lista vacía    → ningún canal.
//   - lista de claves → solo esos. Las claves son las de canalKey() (lib/inbox-canales.ts):
//                       el channel_account_id, o "canal:<canal>" cuando no hay cuenta.
// Solo restringe a los OPERADORES: admin y superadmin son siempre irrestrictos, aunque la
// columna tenga un valor residual. Es lista blanca: un canal nuevo queda oculto a los
// restringidos hasta que se lo agregue, y una clave desconocida no da acceso a nada.
//
// Fail-closed: si la clave del canal no se puede resolver (null/undefined), un restringido no
// ve el ítem. Los irrestrictos no se ven afectados. Las solapas "correo:<id>" no pasan por acá:
// se rigen por correo_casilla_accesos (lib/correo-acceso.ts).

export interface ActorCanales {
  id: string
  role: string
  canalesPermitidos: string[] | null
}

/** Restringido = operador con una lista (aunque esté vacía). */
export function esRestringido(a: Pick<ActorCanales, "role" | "canalesPermitidos">): boolean {
  return a.role === "operator" && a.canalesPermitidos !== null && a.canalesPermitidos !== undefined
}

export function puedeVerCanal(a: ActorCanales, key: string | null | undefined): boolean {
  if (!esRestringido(a)) return true
  if (!key) return false
  return (a.canalesPermitidos as string[]).includes(key)
}

/** Sin restricción devuelve el mismo arreglo (sin copiar). */
export function filtrarPorCanal<T>(a: ActorCanales, items: T[], keyOf: (t: T) => string | null | undefined): T[] {
  if (!esRestringido(a)) return items
  return items.filter((i) => puedeVerCanal(a, keyOf(i)))
}

/** Mapa clave → nombre sin los canales ajenos: los nombres también delatan que el canal existe. */
export function filtrarNombres(a: ActorCanales, nombres: Record<string, string>): Record<string, string> {
  if (!esRestringido(a)) return nombres
  return Object.fromEntries(Object.entries(nombres).filter(([k]) => puedeVerCanal(a, k)))
}

/**
 * Respuesta cruda de ai-api GET /v1/staff/whatsapp-numbers (arreglo, o {numbers: [...]}) sin los
 * números de canales ajenos, conservando el shape y los demás campos. Para irrestrictos devuelve
 * el mismo valor. Ítems sin id o formato desconocido: un restringido no los recibe (fail-closed).
 */
export function filtrarNumerosRaw(a: ActorCanales, raw: unknown): unknown {
  if (!esRestringido(a)) return raw
  const idDe = (item: unknown): string | null => {
    if (!item || typeof item !== "object") return null
    const o = item as Record<string, unknown>
    const id = [o.channelAccountId, o.channel_account_id, o.id].find((v) => typeof v === "string" && v)
    return typeof id === "string" ? id : null
  }
  const visibles = (list: unknown[]) => list.filter((i) => puedeVerCanal(a, idDe(i)))
  if (Array.isArray(raw)) return visibles(raw)
  if (raw && typeof raw === "object" && Array.isArray((raw as { numbers?: unknown }).numbers)) {
    const o = raw as { numbers: unknown[] }
    return { ...o, numbers: visibles(o.numbers) }
  }
  return []
}

export function canalesVisibles(a: ActorCanales, todas: string[]): string[] {
  return filtrarPorCanal(a, todas, (k) => k)
}

/** False solo si el usuario está restringido y su lista está vacía. */
export function tieneAlgunCanal(a: ActorCanales): boolean {
  return !esRestringido(a) || (a.canalesPermitidos as string[]).length > 0
}

/** Operadores/usuarios que pueden atender un canal. Sin canal conocido: solo los irrestrictos. */
export function operadoresConAcceso<T extends { role?: string; canalesPermitidos?: string[] | null }>(
  ops: T[],
  key: string | null | undefined,
): T[] {
  return ops.filter((o) =>
    puedeVerCanal({ id: "", role: o.role ?? "operator", canalesPermitidos: o.canalesPermitidos ?? null }, key),
  )
}

/**
 * Opciones del selector "Canales con acceso": los números de WhatsApp de ai-api, los canales que
 * aparecen en los contactos (p. ej. Instagram sin cuenta), los que el admin nombró y, al final,
 * las claves que ya tiene algún usuario guardadas (para que no desaparezcan del selector si el
 * canal dejó de existir y se pueda quitarlas). Sin repetidos.
 */
export function opcionesDeCanales(input: {
  numeros: { id: string; phone: string | null }[]
  contactos: CanalContacto[]
  nombres: Record<string, string>
  guardadas: string[]
}): { key: string; label: string }[] {
  const out = new Map<string, string>()
  for (const c of canalesEditables(input.contactos, input.numeros)) {
    out.set(c.key, input.nombres[c.key]?.trim() || c.referencia)
  }
  for (const [key, nombre] of Object.entries(input.nombres)) {
    if (!out.has(key) && nombre.trim()) out.set(key, nombre.trim())
  }
  for (const key of input.guardadas) {
    if (out.has(key)) continue
    out.set(key, key.startsWith("canal:") ? channelLabel(key.slice("canal:".length)) : key)
  }
  return [...out.entries()].map(([key, label]) => ({ key, label }))
}

export const CANALES_MAX = 100
export const CANAL_CLAVE_MAX = 200
const CANAL_CLAVE_RE = /^[\w:.\-]+$/

/** Valida el valor de `canales_permitidos` del PATCH: null o arreglo de claves únicas. */
export function parseCanalesPermitidos(raw: unknown): { ok: true; value: string[] | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null }
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Indique los canales permitidos como una lista." }
  }
  if (raw.length > CANALES_MAX) {
    return { ok: false, error: `No puede indicar más de ${CANALES_MAX} canales.` }
  }
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== "string") return { ok: false, error: "Los canales indicados no son válidos." }
    const key = item.trim()
    if (!key || key.length > CANAL_CLAVE_MAX || !CANAL_CLAVE_RE.test(key)) {
      return { ok: false, error: "Los canales indicados no son válidos." }
    }
    if (out.includes(key)) return { ok: false, error: "Los canales indicados no pueden repetirse." }
    out.push(key)
  }
  return { ok: true, value: out }
}
