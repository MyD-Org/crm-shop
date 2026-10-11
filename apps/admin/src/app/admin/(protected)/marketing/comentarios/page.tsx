import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { listarInteracciones } from "@/lib/marketing/otros-repo"
import { BandejaComentarios } from "@/components/admin/marketing/BandejaComentarios"

export const dynamic = "force-dynamic"

export default async function ComentariosPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()
  const pendientes = await listarInteracciones(guard.tenantId, "pendiente")
  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Comentarios</h1>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>Revise la respuesta sugerida y apruébela, edítela u ocúltela.</p>
      </div>
      <BandejaComentarios inicial={pendientes} />
    </div>
  )
}
