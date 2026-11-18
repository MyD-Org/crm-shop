import { and, eq, isNotNull, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers, conversationAssignments } from "@/db/schema"
import { listConversations, type InboxConversation } from "./inbox-api"
import { hayRestringidos, operadoresConAcceso, puedeVerCanal } from "./canal-acceso"
import { canalesDeConversaciones, type TenantInbox } from "./canal-acceso-conversacion"

// Asignación de conversaciones a operadores. El bot (ai-api) solo etiqueta el departamento
// y deja la conversación sin dueño; el CRM elige al operador DISPONIBLE menos cargado y
// PERSISTE la asignación en su propia DB (tabla conversation_assignments en Neon), para que
// no se mezclen entre operadores. ai-api ya no es la fuente de verdad de la asignación.
// Ver ADR 0006 (platform/decisions/0006-...).

export interface Operator {
  id: string
  departments: string[]
  // Acceso por canal (lib/canal-acceso.ts): un operador restringido solo es candidato para las
  // conversaciones de sus canales. Opcionales: sin ellos, el operador es irrestricto.
  role?: string
  canalesPermitidos?: string[] | null
}

export interface Assignment {
  conversationId: string
  operatorId: string
  department: string | null
}

// Canonicaliza un departamento para comparar sin importar formato: el CRM guarda slugs
// ("ventas", "cuentas-corrientes") pero el bot rutea el handoff con la etiqueta que genera
// el modelo ("Ventas", "Cuentas Corrientes"). Normalizamos a minúscula, sin acentos y con
// guiones para que matcheen. Así "Cuentas Corrientes" ≡ "cuentas-corrientes".
export function normalizeDepartment(d: string | null | undefined): string {
  return (d ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
}

/**
 * Operadores DISPONIBLES (presencia + cuenta activa) del tenant, opcionalmente de un depto.
 * El match de departamento es tolerante al formato (ver normalizeDepartment): el filtro por
 * depto se hace en memoria porque el valor que llega del handoff puede venir como etiqueta.
 */
export async function availableOperators(tenantId: string, department?: string | null): Promise<Operator[]> {
  const rows = await getDb()
    .select({
      id: adminUsers.id,
      departments: adminUsers.departments,
      role: adminUsers.role,
      canalesPermitidos: adminUsers.canalesPermitidos,
    })
    .from(adminUsers)
    .where(and(
      eq(adminUsers.tenantId, tenantId),
      isNotNull(adminUsers.passwordHash),
      eq(adminUsers.availability, "available"),
    ))
  if (!department) return rows
  const target = normalizeDepartment(department)
  // Un operador matchea si CUALQUIERA de sus departamentos coincide con el del handoff.
  return rows.filter((op) => op.departments.some((d) => normalizeDepartment(d) === target))
}

/** Todas las asignaciones persistidas del tenant (CRM es la fuente de verdad). */
export async function getAssignments(tenantId: string): Promise<Assignment[]> {
  return getDb()
    .select({
      conversationId: conversationAssignments.conversationId,
      operatorId: conversationAssignments.operatorId,
      department: conversationAssignments.department,
    })
    .from(conversationAssignments)
    .where(eq(conversationAssignments.tenantId, tenantId))
}

/** Persiste (upsert) la asignación de una conversación a un operador en la DB del CRM. */
export async function assignInCrm(
  tenantId: string,
  conversationId: string,
  operatorId: string,
  department: string | null,
): Promise<void> {
  await getDb()
    .insert(conversationAssignments)
    .values({ tenantId, conversationId, operatorId, department })
    .onConflictDoUpdate({
      target: [conversationAssignments.tenantId, conversationAssignments.conversationId],
      set: { operatorId, department, assignedAt: new Date() },
    })
}

/**
 * Igual que assignInCrm pero para varias asignaciones en UNA sola query. La reconciliación
 * corre en cada carga del inbox y en cada poll (10s): hacer un round-trip por conversación
 * multiplicaba la latencia por la cantidad de pendientes.
 * Las filas deben tener conversationId únicos (Postgres no deja que un ON CONFLICT DO UPDATE
 * afecte la misma fila dos veces en un mismo INSERT).
 */
export async function assignManyInCrm(
  tenantId: string,
  rows: { conversationId: string; operatorId: string; department: string | null }[],
): Promise<void> {
  if (!rows.length) return
  await getDb()
    .insert(conversationAssignments)
    .values(rows.map((r) => ({ tenantId, ...r })))
    .onConflictDoUpdate({
      target: [conversationAssignments.tenantId, conversationAssignments.conversationId],
      set: {
        operatorId: sql`excluded.operator_id`,
        department: sql`excluded.department`,
        assignedAt: new Date(),
      },
    })
}

/**
 * Conteo de conversaciones ACTIVAS asignadas a cada operador, según la DB del CRM.
 * Solo cuenta las que siguen activas (activeConvIds viene de ai-api: mode/status en vivo).
 */
export function loadFromAssignments(assignments: Assignment[], activeConvIds: Set<string>): Map<string, number> {
  const load = new Map<string, number>()
  for (const a of assignments) {
    if (!activeConvIds.has(a.conversationId)) continue
    load.set(a.operatorId, (load.get(a.operatorId) ?? 0) + 1)
  }
  return load
}

/** Operadores del tenant con canales restringidos (lista no NULL). Vacío en el caso normal. */
export async function operadoresRestringidos(
  tenantId: string,
): Promise<{ id: string; role: string; canalesPermitidos: string[] | null }[]> {
  return getDb()
    .select({ id: adminUsers.id, role: adminUsers.role, canalesPermitidos: adminUsers.canalesPermitidos })
    .from(adminUsers)
    .where(and(
      eq(adminUsers.tenantId, tenantId),
      eq(adminUsers.role, "operator"),
      isNotNull(adminUsers.canalesPermitidos),
    ))
}

/**
 * Asignaciones cuyo operador ya no tiene acceso al canal de la conversación ("perder acceso
 * devuelve la conversación a la cola"). Solo cuenta cuando el canal es CONOCIDO: una
 * conversación sin canal resuelto no se invalida (sin idas y vueltas con un ai-api viejo; la
 * superficie igual se la oculta al restringido).
 */
export function asignacionesSinAcceso(
  assignments: Assignment[],
  restringidos: { id: string; role: string; canalesPermitidos: string[] | null }[],
  canales: Map<string, string>,
): Assignment[] {
  const porId = new Map(restringidos.map((o) => [o.id, o]))
  return assignments.filter((a) => {
    const op = porId.get(a.operatorId)
    if (!op) return false
    const key = canales.get(a.conversationId)
    return key !== undefined && !puedeVerCanal(op, key)
  })
}

/** Borra asignaciones (solo si siguen siendo del mismo operador). Devuelve cuántas borró. */
export async function quitarAsignaciones(tenantId: string, rows: Assignment[]): Promise<number> {
  let n = 0
  for (const a of rows) {
    const borradas = await getDb()
      .delete(conversationAssignments)
      .where(and(
        eq(conversationAssignments.tenantId, tenantId),
        eq(conversationAssignments.conversationId, a.conversationId),
        eq(conversationAssignments.operatorId, a.operatorId),
      ))
      .returning({ id: conversationAssignments.conversationId })
    n += borradas.length
  }
  return n
}

/**
 * Invalidación EAGER al guardar los canales de un operador: sus asignaciones en canales que ya no
 * tiene vuelven a la cola en el mismo guardado. Best-effort: si ai-api falla, queda para la
 * invalidación de la reconciliación (assignPendingConversations). Devuelve cuántas devolvió.
 */
export async function devolverAsignacionesSinAcceso(
  tenant: { id: string } & TenantInbox,
  operador: { id: string; role: string; canalesPermitidos: string[] | null },
): Promise<number> {
  const propias = (await getAssignments(tenant.id)).filter((a) => a.operatorId === operador.id)
  if (!propias.length) return 0
  const convs = await listConversations(tenant.aiApiUrl, tenant.aiTenantId)
  const propiasIds = new Set(propias.map((a) => a.conversationId))
  const canales = await canalesDeConversaciones(tenant, convs.filter((c) => propiasIds.has(c.id)))
  return quitarAsignaciones(tenant.id, asignacionesSinAcceso(propias, [operador], canales))
}

/** Elige el operador menos cargado del conjunto de candidatos. Devuelve null si está vacío. */
export function pickLeastLoaded(candidates: Operator[], load: Map<string, number>): Operator | null {
  let chosen: Operator | null = null
  let min = Infinity
  for (const op of candidates) {
    const l = load.get(op.id) ?? 0
    if (l < min) { min = l; chosen = op }
  }
  return chosen
}

/**
 * Reconcilia la cola: adopta asignaciones viejas de ai-api al CRM (migración transparente)
 * y asigna las conversaciones derivadas SIN dueño al operador disponible menos cargado del
 * departamento (o de todos, si no tiene depto). Best-effort: errores no rompen el inbox.
 * Se llama al cargar el inbox, al pollear contactos y al ponerse un operador disponible.
 * Ver ADR 0006 (disparador "el CRM la levanta de la cola").
 *
 * Devuelve las conversaciones que usó (o null si no se pudieron traer) Y las asignaciones ya
 * leídas de la DB, para que el caller reutilice ambas y no vuelva a consultar ai-api ni la DB
 * (ej. el listado de contactos que corre justo después). Acepta `convs` ya traídas.
 */
export interface AssignPendingResult {
  convs: InboxConversation[] | null
  assignments: Assignment[]
}

export async function assignPendingConversations(tenant: {
  id: string
  aiApiUrl: string
  aiTenantId: string
}, convs?: InboxConversation[]): Promise<AssignPendingResult> {
  // La llamada a ai-api y la lectura de asignaciones son independientes: en paralelo.
  const [list, assignments] = await Promise.all([
    convs ?? listConversations(tenant.aiApiUrl, tenant.aiTenantId).catch(() => null),
    getAssignments(tenant.id),
  ])
  if (!list) return { convs: null, assignments }
  const convsList = list

  let assignedConvIds = new Set(assignments.map((a) => a.conversationId))
  const activeConvIds = new Set(convsList.filter((c) => c.status !== "closed").map((c) => c.id))

  // Escrituras acumuladas: se mandan todas juntas al final, en una sola query.
  let writes: { conversationId: string; operatorId: string; department: string | null }[] = []

  // Acceso por canal: el canal de cada conversación se resuelve solo si hay restringidos en juego
  // (y una sola vez por pasada). Sin restringidos, la reconciliación es la de siempre.
  let canales: Promise<Map<string, string>> | null = null
  const canalesConv = () => (canales ??= canalesDeConversaciones(tenant, convsList).catch(() => new Map()))
  const restringidos = await operadoresRestringidos(tenant.id).catch(() => [])

  // Migración transparente: conversaciones que ai-api ya tenía asignadas pero el CRM no.
  // Las adoptamos a la DB del CRM sin tocar ai-api. Una sola vez por conversación.
  for (const conv of convsList) {
    if (conv.assigned_operator_id && !assignedConvIds.has(conv.id) && conv.status !== "closed") {
      const row = {
        conversationId: conv.id,
        operatorId: conv.assigned_operator_id,
        department: conv.assigned_department ?? null,
      }
      writes.push(row)
      assignments.push(row)
      assignedConvIds.add(conv.id)
    }
  }

  // Invalidación lazy: asignaciones a quien perdió el acceso al canal vuelven a la cola y se
  // reasignan en esta misma pasada (best-effort; si el borrado falla, se reintenta en la próxima).
  if (restringidos.length && assignments.length) {
    const sinAcceso = asignacionesSinAcceso(assignments, restringidos, await canalesConv())
    if (sinAcceso.length) {
      const fuera = new Set(sinAcceso.map((a) => a.conversationId))
      await quitarAsignaciones(tenant.id, sinAcceso).catch(() => 0)
      for (let i = assignments.length - 1; i >= 0; i--) if (fuera.has(assignments[i].conversationId)) assignments.splice(i, 1)
      writes = writes.filter((w) => !fuera.has(w.conversationId))
      assignedConvIds = new Set(assignments.map((a) => a.conversationId))
    }
  }

  const pending = convsList.filter(
    (c) => c.mode === "human" && c.status !== "closed" && !assignedConvIds.has(c.id),
  )
  if (!pending.length) {
    await flushWrites(tenant.id, writes)
    return { convs: convsList, assignments }
  }

  const load = loadFromAssignments(assignments, activeConvIds)
  // Cache de operadores disponibles por departamento (incl. "" = todos) para no re-consultar.
  const cache = new Map<string, Operator[]>()
  const getCandidates = async (dept: string | null): Promise<Operator[]> => {
    const key = dept ?? ""
    if (!cache.has(key)) cache.set(key, await availableOperators(tenant.id, dept))
    return cache.get(key)!
  }

  for (const conv of pending) {
    const delDepto = await getCandidates(conv.assigned_department ?? null)
    // Nunca se asigna a quien no tiene el canal. Sin canal conocido: solo los irrestrictos.
    const candidates = hayRestringidos(delDepto)
      ? operadoresConAcceso(delDepto, (await canalesConv()).get(conv.id) ?? null)
      : delDepto
    const chosen = pickLeastLoaded(candidates, load)
    if (!chosen) continue // nadie disponible en ese depto → queda en la cola
    const row = { conversationId: conv.id, operatorId: chosen.id, department: conv.assigned_department ?? null }
    writes.push(row)
    assignments.push(row)
    // Subimos su carga para repartir si quedan más pendientes en esta misma pasada.
    load.set(chosen.id, (load.get(chosen.id) ?? 0) + 1)
  }

  await flushWrites(tenant.id, writes)
  return { convs: convsList, assignments }
}

// Best-effort, igual que antes: si la escritura falla, el inbox se sigue mostrando y la
// reconciliación se reintenta en la próxima pasada (carga o poll).
async function flushWrites(
  tenantId: string,
  writes: { conversationId: string; operatorId: string; department: string | null }[],
): Promise<void> {
  try {
    await assignManyInCrm(tenantId, writes)
  } catch {
    /* best-effort */
  }
}
