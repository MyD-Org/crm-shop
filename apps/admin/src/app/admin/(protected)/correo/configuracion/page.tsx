import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { correoHabilitado } from "@/lib/correo-flag"
import { roleRank } from "@/lib/roles"
import { CasillasAccesoEditor } from "@/components/admin/correo/CasillasAccesoEditor"

export const dynamic = "force-dynamic"

// Punto de entrada provisorio de la administración de casillas de correo (R3). En R4 el botón
// pasa a vivir dentro de /admin/correo. Solo admin y superadmin, y solo con el flag `correo`
// prendido: operadores y flag apagado ven un 404.
export default async function CorreoConfiguracionPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()
  if (!(await correoHabilitado())) notFound()

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Casillas de correo</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Defina qué casillas se usan y qué operadores pueden acceder a cada una.
        </p>
      </div>
      <div>
        <CasillasAccesoEditor />
      </div>
    </div>
  )
}
