import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { obtenerMarca } from "@/lib/marketing/marca-repo"
import { MarcaForm } from "@/components/admin/marketing/MarcaForm"

export const dynamic = "force-dynamic"

export default async function MarcaPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()
  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Marca</h1>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>Voz, reglas y hashtags que usan el planificador y el chequeo automático.</p>
      </div>
      <MarcaForm inicial={await obtenerMarca(guard.tenantId)} />
    </div>
  )
}
