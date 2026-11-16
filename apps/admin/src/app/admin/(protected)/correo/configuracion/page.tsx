import { redirect } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { isKnownAdminRole } from "@/lib/roles"

// La administración de casillas vive ahora en Mensajes (botón "Administrar casillas" junto a las
// solapas). Esta ruta provisoria de R3 solo redirige, para no romper enlaces ya compartidos.
export default async function CorreoConfiguracionPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || !isKnownAdminRole(guard.user.role)) redirect("/admin/login")
  redirect("/admin/inbox")
}
