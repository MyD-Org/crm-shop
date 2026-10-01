import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { listarEscalones, listarProveedores, toEscalonDto, toProveedorDto } from "@/lib/cuotas-repo"
import { obtenerTasasMercadoPago, type TasasMP } from "@/lib/mp-tasas"
import { CuotasTab } from "@/components/admin/CuotasTab"
import { MediosPagoShopCard } from "@/components/admin/MediosPagoShopCard"

export const dynamic = "force-dynamic"

// Pagos y cuotas: proveedores de pago y escalones de cuotas del Shop (grupo Datos del menú).
// Admin+ (operator → 404). Las tasas de Mercado Pago (MP_PUBLIC_KEY) se consultan acá con
// caché de 1 h; si MP falla la página carga igual con un aviso.
export default async function CuotasPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()

  const [proveedores, escalones, tasasMP] = await Promise.all([
    listarProveedores(guard.tenantId),
    listarEscalones(guard.tenantId),
    obtenerTasasMercadoPago({ publicKey: process.env.MP_PUBLIC_KEY }).catch((): TasasMP => ({ estado: "error" })),
  ])

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Pagos y cuotas</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Proveedores de pago, cuotas y medios de pago del checkout
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <CuotasTab
          initialProveedores={proveedores.map(toProveedorDto)}
          initialEscalones={escalones.map(toEscalonDto)}
          tasasMP={tasasMP}
        />
        <MediosPagoShopCard />
      </div>
    </div>
  )
}
