import { eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { normalizeSchedule, normalizeExceptions } from "@/lib/schedule"
import { ScheduleForm } from "@/components/admin/ScheduleForm"

export const dynamic = "force-dynamic"

// Horario de atención del local y excepciones (feriados, vacaciones). Lo leen el Shop y el
// bot para decir si el local está abierto. Admin+ (operator → 404).
export default async function HorariosPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()

  const [tenant] = await getDb()
    .select({ schedule: tenants.schedule, scheduleExceptions: tenants.scheduleExceptions })
    .from(tenants)
    .where(eq(tenants.id, guard.tenantId))

  const initialSchedule = {
    schedule: normalizeSchedule(tenant?.schedule),
    exceptions: normalizeExceptions(tenant?.scheduleExceptions),
  }

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Horarios</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Horario de atención del local y excepciones
        </p>
      </div>
      <ScheduleForm initialSchedule={initialSchedule} />
    </div>
  )
}
