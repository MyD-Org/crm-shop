import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { leerHorario, listarSucursalesActivas } from "@/lib/horarios-repo"
import { resolverSucursalElegida } from "@/lib/horarios-seleccion"
import { ScheduleForm } from "@/components/admin/ScheduleForm"

export const dynamic = "force-dynamic"

// Horario de atención y excepciones (feriados, vacaciones). Lo leen el Shop y el bot para decir si
// el local está abierto. Con sucursales activas se edita el de cada una (selector, `?sucursal=`);
// sin sucursales, el de la empresa. Admin+ (operator → 404).
export default async function HorariosPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string | string[] }>
}) {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()

  const { sucursal } = await searchParams
  const activas = await listarSucursalesActivas(guard.tenantId)
  const slug = resolverSucursalElegida(activas, sucursal)

  const horario = await leerHorario(guard.tenantId, slug)
  if (horario.kind === "not_found") notFound()

  const elegida = activas.find((s) => s.slug === slug)

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Horarios</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          {elegida ? `Horario de atención y excepciones de ${elegida.nombre}` : "Horario de atención del local y excepciones"}
        </p>
      </div>
      {/* key: al cambiar de sucursal el formulario se vuelve a montar con el horario de esa sucursal. */}
      <ScheduleForm
        key={slug ?? "empresa"}
        initialSchedule={{ schedule: horario.schedule, exceptions: horario.exceptions }}
        sucursales={activas}
        sucursalSlug={slug}
      />
    </div>
  )
}
