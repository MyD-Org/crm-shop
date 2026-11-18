import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers, tenants } from "@/db/schema"
import { requireSeccion } from "@/lib/admin-route-guard"
import { cuentaDeConversacion, exigirAccesoConversacion } from "@/lib/canal-acceso-conversacion"
import { esRestringido, hayRestringidos, operadoresConAcceso, puedeVerCanal } from "@/lib/canal-acceso"
import { listConversations } from "@/lib/inbox-api"
import { assignInCrm, availableOperators, getAssignments, loadFromAssignments, pickLeastLoaded } from "@/lib/assignment"
import { sendPushToOperator } from "@/lib/push"

/** UUID v4 canónico, el formato que genera `defaultRandom()` en `admin_users.id`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/admin/inbox/:id/assign
//
// Cuerpos aceptados:
//   { operatorId: string }                            → asigna a ese operador directamente (por UUID)
//   { strategy: "least-loaded", department?: string } → elige al operador con menos
//                                                       conversaciones activas asignadas;
//                                                       si se pasa department filtra por él
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSeccion(req, "inbox")
  if (!guard.ok) return guard.response

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "body requerido" }, { status: 400 })

  const db = getDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, guard.tenantId))
  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    return NextResponse.json({ error: "inbox no configurado" }, { status: 503 })
  }

  // Acceso por canal ANTES de cualquier efecto: ajena o inexistente = el mismo 404.
  const acceso = await exigirAccesoConversacion(
    { aiApiUrl: tenant.aiApiUrl, aiTenantId: tenant.aiTenantId }, guard.user, id,
  )
  if (!acceso.ok) return acceso.response

  let targetOperatorId: string

  // Canal de la conversación, resuelto una sola vez y solo si hace falta (algún restringido en
  // juego). Si ya lo resolvió el chequeo del actor, se reutiliza.
  const tenantInbox = { aiApiUrl: tenant.aiApiUrl, aiTenantId: tenant.aiTenantId }
  let canalResuelto: Promise<string | null> | null =
    acceso.canalKey !== undefined ? Promise.resolve(acceso.canalKey) : null
  const canal = () => (canalResuelto ??= cuentaDeConversacion(tenantInbox, id).catch(() => null))

  // Depto de la conversación (lo etiquetó el bot en ai-api): lo usamos para elegir
  // candidatos y para guardarlo como snapshot en la asignación del CRM.
  const convs = await listConversations(tenant.aiApiUrl, tenant.aiTenantId).catch(() => [])
  const conv = convs.find((c) => c.id === id)
  const convDepartment = conv?.assigned_department ?? null

  if (typeof body.operatorId === "string" && body.operatorId.trim()) {
    const requested = body.operatorId.trim()

    // Validar la FORMA antes de tocar la DB: `admin_users.id` es uuid y un string que no lo
    // sea levanta 22P02 en Postgres → 500. Ese 500 distingue "id mal formado" de "id de otro
    // tenant" (404) y funciona como oráculo para enumerar. Mismo 404 para los dos casos.
    if (!UUID_RE.test(requested)) {
      return NextResponse.json({ error: "operador no encontrado" }, { status: 404 })
    }

    // El operador tiene que ser de ESTE tenant. Sin este filtro, cualquier operador podía
    // asignarle una conversación a un usuario de otro tenant mandando su UUID (IDOR): el
    // destinatario terminaba viendo —y notificado por push sobre— datos de un cliente ajeno.
    // `passwordHash` NOT NULL = cuenta activa; una invitación pendiente no puede recibir.
    const [operator] = await db
      .select({
        id: adminUsers.id,
        passwordHash: adminUsers.passwordHash,
        role: adminUsers.role,
        canalesPermitidos: adminUsers.canalesPermitidos,
      })
      .from(adminUsers)
      .where(and(eq(adminUsers.id, requested), eq(adminUsers.tenantId, guard.tenantId)))

    if (!operator || !operator.passwordHash) {
      return NextResponse.json({ error: "operador no encontrado" }, { status: 404 })
    }

    // Acceso por canal del DESTINATARIO: no se le asigna una conversación que no puede ver. 409
    // (no 404): quien asigna ya ve la conversación, así que no revela nada.
    if (esRestringido(operator) && !puedeVerCanal(operator, await canal())) {
      return NextResponse.json({ error: "El operador seleccionado no tiene acceso a este canal." }, { status: 409 })
    }

    targetOperatorId = operator.id
  } else if (body.strategy === "least-loaded") {
    // Mismo criterio que la reconciliación automática (ADR 0006): operadores DISPONIBLES
    // del depto + menos cargado. La carga se cuenta desde la DB del CRM (fuente de verdad).
    const disponibles = await availableOperators(guard.tenantId, body.department ?? null)
    // Solo candidatos con acceso al canal (sin restringidos entre ellos, no se resuelve nada).
    const operators = hayRestringidos(disponibles) ? operadoresConAcceso(disponibles, await canal()) : disponibles
    if (!operators.length) {
      const reason = body.department
        ? `no hay operadores disponibles en el departamento "${body.department}"`
        : "no hay operadores disponibles"
      return NextResponse.json({ error: reason }, { status: 404 })
    }

    const assignments = await getAssignments(guard.tenantId)
    const activeConvIds = new Set(convs.filter((c) => c.status !== "closed").map((c) => c.id))
    const chosen = pickLeastLoaded(operators, loadFromAssignments(assignments, activeConvIds))
    targetOperatorId = chosen!.id
  } else {
    return NextResponse.json(
      { error: "Se requiere operatorId o strategy='least-loaded'" },
      { status: 400 },
    )
  }

  await assignInCrm(guard.tenantId, id, targetOperatorId, body.department ?? convDepartment)

  // Notifica al operador asignado (salvo que se haya autoasignado: ya lo sabe). Best-effort.
  if (targetOperatorId !== guard.user.id) {
    const contactName = conv?.contact || "un cliente"
    await sendPushToOperator(guard.tenantId, targetOperatorId, {
      title: "Nueva conversación asignada",
      body: `Se le asignó la conversación con ${contactName}.`,
      url: `/admin/inbox/${id}`,
      icon: `/logos/${tenant.id}-icon.svg`,
      tag: `assign-${id}`,
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, assigned_operator_id: targetOperatorId })
}
