import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { listarSucursales, listarZonas, toSucursalDto, toZonaDto } from "@/lib/sucursales-repo"
import { listarCuentas } from "@/lib/alegra-cuentas-repo"
import { SucursalesTab } from "@/components/admin/SucursalesTab"

export const dynamic = "force-dynamic"

// Sucursales y zonas de venta: dato maestro con alta, baja y estado, por eso es una sección
// propia del menú (grupo Datos) y no una pestaña de configuración. Admin+ (operator → 404).
export default async function SucursalesPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()

  const [sucursales, zonas, cuentas] = await Promise.all([
    listarSucursales(guard.tenantId),
    listarZonas(guard.tenantId),
    listarCuentas(guard.tenantId),
  ])

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Sucursales</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Locales de retiro, zonas de venta y reglas de venta del negocio
        </p>
      </div>
      <SucursalesTab
        initialSucursales={sucursales.map(toSucursalDto)}
        initialZonas={zonas.map(toZonaDto)}
        initialCuentas={cuentas}
      />
    </div>
  )
}
