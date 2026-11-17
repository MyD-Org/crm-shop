import { redirect } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { isKnownAdminRole } from "@/lib/roles"
import { accesoSeccion } from "@/lib/secciones-acceso"

// Configuración dejó de existir como sección: sus pestañas pasaron a entradas propias del menú
// (Sucursales, Pagos y cuotas, Horarios) y el mail de avisos vive en Comprobantes → Ajustes.
// La ruta queda sólo para que los links viejos (mails, favoritos) no den 404: lleva a Horarios si
// el usuario tiene esa sección y, si no, a su primera sección visible (`/admin`).
export default async function ConfiguracionPage() {
  // Allow-list: el rol «compras» no recorre redirects hacia secciones que no le corresponden.
  const guard = await getGuardedAdminSession()
  if (!guard.ok || !isKnownAdminRole(guard.user.role)) redirect("/admin/login")
  redirect((await accesoSeccion("horarios")) ? "/admin/horarios" : "/admin")
}
