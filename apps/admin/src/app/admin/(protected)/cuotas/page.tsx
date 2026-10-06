import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { MediosPagoShopCard } from "@/components/admin/MediosPagoShopCard"
import { CuentasBancariasShopCard } from "@/components/admin/CuentasBancariasShopCard"

export const dynamic = "force-dynamic"

// Pagos y cuotas: medios de pago del checkout (con sus cuotas sin interés por lista de precios) y
// cuentas bancarias del Shop (grupo Datos del menú). Admin+ (operator → 404).
export default async function CuotasPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Pagos y cuotas</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Medios de pago del checkout, cuotas sin interés y cuentas bancarias
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <MediosPagoShopCard />
        <CuentasBancariasShopCard />
      </div>
    </div>
  )
}
