import { adminNotFoundResponse } from "@/lib/admin-route-guard"
import {
  getConversationCanal,
  listContacts,
  listConversations,
  type InboxConversation,
} from "@/lib/inbox-api"
import { canalKey } from "@/lib/inbox-canales"
import { esRestringido, puedeVerCanal, type ActorCanales } from "@/lib/canal-acceso"

// Acceso por canal sobre CONVERSACIONES (rutas por id, asignación, push, contadores). La política
// es la de lib/canal-acceso.ts; acá solo se resuelve conversationId → clave de canal, que vive en
// ai-api. Todo lo de este archivo se paga SOLO cuando hay un usuario restringido en juego: para
// los irrestrictos no se hace ninguna llamada extra.
//
// Fuentes, en orden:
//   1. GET /v1/inbox/conversations/:id (contrato S2): una conversación, barata.
//   2. El listado legacy /v1/inbox/conversations, si sus ítems ya traen channel_account_id (S2).
//   3. ai-api anterior a S2: la lista de contactos (scope=all), que ya trae la cuenta de la
//      conversación EN CURSO de cada contacto. Cubre lo que un operador tiene abierto; una
//      conversación vieja que no aparece ahí queda sin resolver.
// Sin resolver = null => un restringido no la ve (fail-closed).

export interface TenantInbox {
  aiApiUrl: string
  aiTenantId: string
}

/**
 * Clave de canal de una conversación del listado legacy. `undefined` = ai-api no manda el dato
 * (anterior a S2): no es lo mismo que una conversación sin cuenta (`canal:<canal>`).
 */
export function canalDeConversacion(c: Pick<InboxConversation, "channel" | "channel_account_id">): string | undefined {
  if (!Object.hasOwn(c, "channel_account_id")) return undefined
  return canalKey({ channel: c.channel, channel_account_id: c.channel_account_id ?? null })
}

/** conversationId → clave de canal de la conversación en curso de cada contacto. */
async function canalesDesdeContactos(tenant: TenantInbox): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const contactos = await listContacts(tenant.aiApiUrl, tenant.aiTenantId, "all").catch(() => [])
  for (const c of contactos) {
    if (c.current_conversation_id) out.set(c.current_conversation_id, canalKey(c))
  }
  return out
}

/**
 * Clave de canal de varias conversaciones ya traídas del listado legacy. Si alguna no trae el
 * dato (ai-api anterior a S2) se consulta UNA vez la lista de contactos. Las que no se pueden
 * resolver no figuran en el mapa (desconocidas).
 */
export async function canalesDeConversaciones(
  tenant: TenantInbox,
  convs: Pick<InboxConversation, "id" | "channel" | "channel_account_id">[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let faltan = false
  for (const c of convs) {
    const key = canalDeConversacion(c)
    if (key === undefined) faltan = true
    else out.set(c.id, key)
  }
  if (faltan) {
    for (const [id, key] of await canalesDesdeContactos(tenant)) if (!out.has(id)) out.set(id, key)
  }
  return out
}

/** Clave de canal de UNA conversación, o null si no existe o no se puede resolver. */
export async function cuentaDeConversacion(tenant: TenantInbox, conversationId: string): Promise<string | null> {
  const directa = await getConversationCanal(tenant.aiApiUrl, tenant.aiTenantId, conversationId)
  if (directa.status === "ok") return canalKey(directa)
  if (directa.status === "not_found") return null

  const convs = await listConversations(tenant.aiApiUrl, tenant.aiTenantId).catch(() => null)
  const conv = convs?.find((c) => c.id === conversationId)
  const key = conv ? canalDeConversacion(conv) : undefined
  if (key !== undefined) return key
  return (await canalesDesdeContactos(tenant)).get(conversationId) ?? null
}

/**
 * Exige que el actor pueda ver la conversación ANTES de cualquier efecto. Irrestricto: ok sin
 * llamar a ai-api. Restringido sin acceso (o conversación inexistente o sin canal resoluble): el
 * mismo 404 de `adminNotFoundResponse`, indistinguible de un id que no existe.
 * Se usa después de `requireSeccion(req, "inbox")`: la sección y el canal son dos filtros.
 * `canalKey` vuelve solo si se resolvió (restringido), para que la ruta no lo resuelva dos veces.
 */
export async function exigirAccesoConversacion(
  tenant: TenantInbox,
  actor: ActorCanales,
  conversationId: string,
): Promise<{ ok: true; canalKey?: string | null } | { ok: false; response: Response }> {
  if (!esRestringido(actor)) return { ok: true }
  const key = await cuentaDeConversacion(tenant, conversationId).catch(() => null)
  if (!puedeVerCanal(actor, key)) return { ok: false, response: adminNotFoundResponse() }
  return { ok: true, canalKey: key }
}
