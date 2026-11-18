import webpush from "web-push"
import { and, eq, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers, pushSubscriptions } from "@/db/schema"
import { availableOperators } from "@/lib/assignment"
import { esRestringido, hayRestringidos, operadoresConAcceso, puedeVerCanal } from "@/lib/canal-acceso"
import { destinatariosCasilla } from "@/lib/correo-repo"

// ── Web Push ────────────────────────────────────────────────────────────────
// El CRM es dueño de las suscripciones (los operadores son usuarios del CRM) y el único que
// envía notificaciones push. ai-api solo dispara eventos vía /api/internal/inbox-events.
// Todo va GATEADO por las claves VAPID: sin env vars, esto es no-op (dev/local sin config).

export interface PushPayload {
  title: string
  body: string
  // Ruta a la que lleva el click. El service worker la abre/enfoca.
  url?: string
  // Ícono a mostrar (ruta del logo del tenant). El SW cae a un default si no viene.
  icon?: string
  // Agrupa/reemplaza notificaciones del mismo hilo (ej. no apilar 5 avisos de la misma conv).
  tag?: string
}

// Canal de la conversación del evento, resuelto a pedido (y una sola vez): solo hace falta si
// algún destinatario está restringido por canal (lib/canal-acceso.ts). null = desconocido, y
// entonces los restringidos no reciben (fail-closed).
export type CanalDelEvento = () => Promise<string | null>

/** Memoiza el resolvedor: varias funciones de push pueden pedir el mismo canal. */
export function canalDelEvento(resolver: () => Promise<string | null>): CanalDelEvento {
  let p: Promise<string | null> | null = null
  return () => (p ??= resolver().catch(() => null))
}

let configured = false

/** Configura VAPID una sola vez. Devuelve false si faltan las claves (push deshabilitado). */
function ensureConfigured(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return false
  if (!configured) {
    // El subject identifica al emisor ante el push service (mailto o URL del sitio).
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:soporte@myd-org.com", publicKey, privateKey)
    configured = true
  }
  return true
}

/**
 * Envía un push a TODAS las suscripciones de un operador (todos sus dispositivos).
 * Poda automáticamente las suscripciones muertas (404/410 = el navegador la revocó).
 * Best-effort: nunca lanza — un fallo de push no debe romper el flujo que lo disparó.
 */
export async function sendPushToOperator(tenantId: string, operatorId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0
  const db = getDb()
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.operatorId, operatorId)))

  let delivered = 0
  const body = JSON.stringify(payload)

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        )
        delivered++
        await db
          .update(pushSubscriptions)
          .set({ lastUsedAt: new Date() })
          .where(eq(pushSubscriptions.id, sub.id))
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        // 404/410: la suscripción ya no existe en el push service → la borramos.
        if (statusCode === 404 || statusCode === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
        } else {
          console.error("push send error:", statusCode ?? err)
        }
      }
    }),
  )

  return delivered
}

/**
 * Push a UN usuario solo si puede ver el canal de la conversación. Sin `canal`, igual que
 * sendPushToOperator. Un restringido sin acceso (o con canal desconocido) no recibe.
 */
export async function sendPushToOperatorConAcceso(
  tenantId: string,
  operatorId: string,
  payload: PushPayload,
  canal?: CanalDelEvento,
): Promise<number> {
  if (!ensureConfigured()) return 0
  if (canal) {
    const [u] = await getDb()
      .select({ id: adminUsers.id, role: adminUsers.role, canalesPermitidos: adminUsers.canalesPermitidos })
      .from(adminUsers)
      .where(and(eq(adminUsers.tenantId, tenantId), eq(adminUsers.id, operatorId)))
    if (u && esRestringido(u) && !puedeVerCanal(u, await canal())) {
      console.info("[push] omitido: el destinatario no tiene acceso al canal", { tenantId, operatorId })
      return 0
    }
  }
  return sendPushToOperator(tenantId, operatorId, payload)
}

/**
 * Envía un push a los operadores DISPONIBLES de un departamento (cola de handoff sin dueño).
 * Si no se pasa department, notifica a todos los disponibles del tenant.
 * Con `canal`, solo a quienes ven ese canal; si había disponibles pero ninguno con acceso, el
 * aviso cae a admin y superadmin (alguien tiene que enterarse). Si no había nadie disponible, como
 * siempre: no se envía.
 */
export async function sendPushToDepartment(
  tenantId: string,
  department: string | null,
  payload: PushPayload,
  canal?: CanalDelEvento,
): Promise<number> {
  if (!ensureConfigured()) return 0
  const disponibles = await availableOperators(tenantId, department)
  const operators = canal && hayRestringidos(disponibles) ? operadoresConAcceso(disponibles, await canal()) : disponibles
  if (disponibles.length && !operators.length) return sendPushToAdmins(tenantId, payload)
  const counts = await Promise.all(operators.map((op) => sendPushToOperator(tenantId, op.id, payload)))
  return counts.reduce((a, b) => a + b, 0)
}

/** Push a los admin y superadmin del tenant (respaldo cuando nadie del depto ve el canal). */
export async function sendPushToAdmins(tenantId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0
  const admins = await getDb()
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(and(eq(adminUsers.tenantId, tenantId), inArray(adminUsers.role, ["admin", "superadmin"])))
  const counts = await Promise.all(admins.map((a) => sendPushToOperator(tenantId, a.id, payload)))
  return counts.reduce((a, b) => a + b, 0)
}

/**
 * Envía un push a quienes tienen acceso a una casilla de correo (lista de accesos + admin y
 * superadmin del tenant). Sin filtro de disponibilidad: el correo no tiene asignación ni
 * presencia. Best-effort como el resto.
 */
export async function sendPushToCasilla(tenantId: string, casillaId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0
  const ids = await destinatariosCasilla(tenantId, casillaId)
  const counts = await Promise.all(ids.map((id) => sendPushToOperator(tenantId, id, payload)))
  return counts.reduce((a, b) => a + b, 0)
}

/**
 * Envía un push a los SUPERADMINS del tenant (todos sus dispositivos). Para avisos de
 * administración (ej. costos de WhatsApp) que no pertenecen a ninguna conversación.
 */
export async function sendPushToSuperadmins(tenantId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0
  const admins = await getDb()
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(and(eq(adminUsers.tenantId, tenantId), eq(adminUsers.role, "superadmin")))
  const counts = await Promise.all(admins.map((a) => sendPushToOperator(tenantId, a.id, payload)))
  return counts.reduce((a, b) => a + b, 0)
}
