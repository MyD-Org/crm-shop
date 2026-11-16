import { getGuardedAdminSession } from "@/lib/admin-session"
import { comprasHabilitado, comprasRecepcionHabilitada } from "@/lib/compras-flag"
import { esRolCompras, isKnownAdminRole, roleRank } from "@/lib/roles"

// Acceso de las PÁGINAS de Compras (las rutas API usan `requireComprasAccess`). Misma regla: el
// rol lateral «compras» o admin/superadmin, con el flag `compras-en-transito` prendido. El rol sale
// de la fila fresca de la base (getGuardedAdminSession), nunca de la cookie. null = `notFound()`.

export interface AccesoCompras {
  tenantId: string
  userId: string
  role: string
  esAdmin: boolean
  /** `compras-recepcion`: habilita editar (y, más adelante, recibir). */
  edicionHabilitada: boolean
}

export async function accesoCompras(): Promise<AccesoCompras | null> {
  const guard = await getGuardedAdminSession()
  if (!guard.ok) return null
  const role = guard.user.role
  const permitido = esRolCompras(role) || (isKnownAdminRole(role) && roleRank(role) >= 1)
  if (!permitido) return null
  if (!(await comprasHabilitado())) return null
  return {
    tenantId: guard.tenantId,
    userId: guard.user.id,
    role,
    esAdmin: isKnownAdminRole(role) && roleRank(role) >= 1,
    edicionHabilitada: await comprasRecepcionHabilitada(),
  }
}
