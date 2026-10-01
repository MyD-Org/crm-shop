import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { EnviosCard } from "@/components/admin/EnviosCard"

export const dynamic = "force-dynamic"

// Envíos: si la tienda ofrece envío a domicilio y cuándo es gratis. Dato maestro del negocio,
// por eso es una sección propia del menú (grupo Datos). Admin+ (operator → 404).
export default async function EnviosPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Envíos</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Envío a domicilio y envío gratis de la tienda
        </p>
      </div>
      <EnviosCard />
    </div>
  )
}
