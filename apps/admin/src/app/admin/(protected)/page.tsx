import { redirect } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { comprasHabilitado } from "@/lib/compras-flag"
import { botUsagePanelEnabled } from "@/lib/flags"
import { esRolCompras, isKnownAdminRole } from "@/lib/roles"
import { primeraSeccionVisible, seccionesVisibles } from "@/lib/secciones"

// Entrada al backoffice (el login empuja acá): la primera sección de trabajo que el usuario ve en
// el menú, así nadie cae en el 404 de una sección que no tiene (p. ej. sin Mensajes).
export default async function AdminRootPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok) redirect("/admin/login")
  // El rol «compras» sólo tiene el módulo Compras.
  if (esRolCompras(guard.user.role)) redirect("/admin/compras")
  if (!isKnownAdminRole(guard.user.role)) redirect("/admin/login")
  const [compras, usagePanel] = await Promise.all([comprasHabilitado(), botUsagePanelEnabled()])
  redirect(primeraSeccionVisible(seccionesVisibles(guard.user, { compras, usagePanel })))
}
