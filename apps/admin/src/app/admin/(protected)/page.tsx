import { redirect } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { esRolCompras, isKnownAdminRole } from "@/lib/roles"

export default async function AdminRootPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok) redirect("/admin/login")
  // El rol «compras» sólo tiene el módulo Compras; el resto entra por Mensajes.
  if (esRolCompras(guard.user.role)) redirect("/admin/compras")
  if (!isKnownAdminRole(guard.user.role)) redirect("/admin/login")
  redirect("/admin/inbox")
}
