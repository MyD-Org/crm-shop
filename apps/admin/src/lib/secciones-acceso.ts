import { getGuardedAdminSession } from "@/lib/admin-session"
import type { AdminGuardUser } from "@/lib/admin-route-guard"
import { comprasHabilitado } from "@/lib/compras-flag"
import { autorizaSeccion, type ClaveOAlguna, type OpcionesSeccion } from "@/lib/secciones"

// Guard de las PÁGINAS de una sección (las rutas API usan `requireSeccion` de
// lib/admin-route-guard.ts). Misma decisión (`autorizaSeccion`) sobre la fila fresca de
// admin_users, nunca la cookie. null => la página hace `notFound()` (la sesión inválida ya la
// redirigió el layout protegido; acá también da null, por las dudas).

export interface AccesoSeccion {
  tenantId: string
  user: AdminGuardUser
  userId: string
  role: string
}

export async function accesoSeccion(clave: ClaveOAlguna, opts?: OpcionesSeccion): Promise<AccesoSeccion | null> {
  const guard = await getGuardedAdminSession()
  if (!guard.ok) return null
  if (!(await autorizaSeccion(guard.user, clave, opts, comprasHabilitado))) return null
  return { tenantId: guard.tenantId, user: guard.user, userId: guard.user.id, role: guard.user.role }
}
