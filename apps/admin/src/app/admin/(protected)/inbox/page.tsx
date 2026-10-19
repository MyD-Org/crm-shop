import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { adminSessionOptions, getGuardedAdminSession, type AdminSessionData } from "@/lib/admin-session"
import { getBotStatus, listWhatsappNumbersRaw, type InboxContact } from "@/lib/inbox-api"
import { assignPendingConversations } from "@/lib/assignment"
import { listEnrichedContacts } from "@/lib/inbox-contacts"
import { listarNombres } from "@/lib/inbox-canales-repo"
import { filtrarNombres, filtrarNumerosRaw, type ActorCanales } from "@/lib/canal-acceso"
import { parseWhatsappNumbers } from "@/lib/inbox-canales"
import { roleRank } from "@/lib/roles"
import { casillasAccesibles } from "@/lib/correo-acceso"
import { correoHabilitado } from "@/lib/correo-flag"
import { contarNoLeidosPorCasilla } from "@/lib/correo-repo"
import { InboxList } from "@/components/admin/InboxList"
import { BotKillSwitch } from "@/components/admin/BotKillSwitch"

export const dynamic = "force-dynamic"

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ casilla?: string; hilo?: string }> }) {
  const { casilla: casillaParam, hilo: hiloParam } = await searchParams
  const session = await getIronSession<AdminSessionData>(await cookies(), adminSessionOptions)
  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, session.tenantId))

  let contacts: InboxContact[] = []
  let botEnabled = true
  let configError = ""
  // Números activos en ai-api: una solapa con nombre solo queda fija si su canal sigue habilitado.
  // null = no se pudo consultar; las solapas se arman como antes.
  let canalesHabilitados: string[] | null = null
  // Política de canales con la fila FRESCA del usuario (no la cookie). Si no se puede resolver
  // se asume restringido sin canales (fail-closed): el layout protegido ya cubre el caso sin sesión.
  const guardedUser = await getGuardedAdminSession().catch(() => null)
  const actor: ActorCanales =
    guardedUser?.ok === true
      ? guardedUser.user
      : { id: session.userId, role: "operator", canalesPermitidos: [] }
  // Los nombres de canal también delatan canales ajenos: se filtran ANTES de armar las solapas.
  const canalNombres = filtrarNombres(
    actor,
    await listarNombres(session.tenantId).catch(() => ({}) as Record<string, string>),
  )

  // Casillas de correo como solapas de Mensajes. Con el flag `correo` apagado (o ante un error)
  // la pantalla queda idéntica a la de siempre. El rol sale de la fila fresca de admin_users.
  const correoOn = await correoHabilitado()
  let casillas: { id: string; nombre: string; email: string; noLeidos: number }[] = []
  if (correoOn) {
    try {
      if (guardedUser?.ok) {
        const accesibles = await casillasAccesibles(session.tenantId, { id: guardedUser.user.id, role: guardedUser.user.role })
        const conteo = await contarNoLeidosPorCasilla(accesibles.map((c) => c.id))
        casillas = accesibles.map((c) => ({ id: c.id, nombre: c.nombre, email: c.email, noLeidos: conteo[c.id] ?? 0 }))
      }
    } catch {
      casillas = []
    }
  }
  const casillaInicial = casillas.some((c) => c.id === casillaParam) ? (casillaParam ?? null) : null

  if (!tenant?.aiTenantId || !tenant?.aiApiUrl) {
    configError = "El inbox no está configurado. Complete AI_TENANT_ID y AI_API_URL en la config del tenant."
  } else {
    const tenantRef = { id: tenant.id, aiApiUrl: tenant.aiApiUrl, aiTenantId: tenant.aiTenantId }
    try {
      // Levanta de la cola las conversaciones derivadas sin operador y les asigna el
      // menos cargado del depto antes de listar. Best-effort (no rompe el inbox). ADR 0006.
      // Reutilizamos las conversaciones que trajo la reconciliación para no re-consultarlas.
      // El estado del bot no depende de la reconciliación: va en paralelo, no en cascada.
      const botStatusPromise = getBotStatus(tenant.aiApiUrl, tenant.aiTenantId)
      const { convs, assignments } = await assignPendingConversations(tenantRef)
      contacts = await listEnrichedContacts(tenantRef, "active", convs, assignments, actor)
      botEnabled = await botStatusPromise
      canalesHabilitados = await listWhatsappNumbersRaw(tenant.aiApiUrl, tenant.aiTenantId, session.role)
        .then(async (r) => (r.ok ? parseWhatsappNumbers(filtrarNumerosRaw(actor, await r.json())).map((n) => n.id) : null))
        .catch(() => null)
    } catch {
      configError = "No se pudo conectar con la API. Verifique la configuración."
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 md:mb-6 flex items-center md:items-start justify-between gap-3 flex-wrap">
        {/* Título flush-left: el FAB de nav va a bottom-right en mobile-mode='bottom-sheet',
            así que ya no hay que reservar padding izquierdo para la hamburguesa. */}
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Mensajes</h1>
          {/* El subtítulo es contexto redundante y ocupa alto valioso en mobile: solo en desktop. */}
          <p className="hidden md:block text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>Conversaciones de los canales de mensajería</p>
        </div>
        {/* Estado del bot (kill switch global). La presencia del operador vive en el pie del
            sidebar (AdminShell), no acá: el header es para el estado de la operación. */}
        {/* Kill switch global del bot: visible para todos los usuarios del backoffice (sin gate de rol). */}
        {!configError && <BotKillSwitch initialEnabled={botEnabled} />}
      </div>

      {configError ? (
        <div className="rounded-[var(--radius)] p-4 text-sm" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
          {configError}
        </div>
      ) : (
        <InboxList initialContacts={contacts} currentUserId={session.userId} initialBotEnabled={botEnabled}
          initialCanalNombres={canalNombres}
          canalesHabilitados={canalesHabilitados}
          canEditCanales={roleRank(session.role) >= 1}
          casillas={casillas}
          correoHabilitado={correoOn}
          initialCasillaId={casillaInicial}
          initialHiloId={casillaInicial ? (hiloParam ?? null) : null}
        />
      )}
    </div>
  )
}
