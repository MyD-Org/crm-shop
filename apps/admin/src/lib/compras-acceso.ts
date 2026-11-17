import { comprasRecepcionHabilitada } from "@/lib/compras-flag"
import { isKnownAdminRole, roleRank } from "@/lib/roles"
import { accesoSeccion } from "@/lib/secciones-acceso"

// Acceso de las PÁGINAS de Compras (las rutas API usan `requireComprasAccess`). Wrapper de
// `accesoSeccion("compras")`: el rol lateral «compras» o quien tenga la sección (admin/superadmin
// por defecto), con el flag `compras-en-transito` prendido. El rol sale de la fila fresca de la
// base, nunca de la cookie. null = `notFound()`.

export interface AccesoCompras {
  tenantId: string
  userId: string
  role: string
  esAdmin: boolean
  /** `compras-recepcion`: habilita editar (y, más adelante, recibir). */
  edicionHabilitada: boolean
}

export async function accesoCompras(): Promise<AccesoCompras | null> {
  const acceso = await accesoSeccion("compras")
  if (!acceso) return null
  const role = acceso.role
  return {
    tenantId: acceso.tenantId,
    userId: acceso.userId,
    role,
    esAdmin: isKnownAdminRole(role) && roleRank(role) >= 1,
    edicionHabilitada: await comprasRecepcionHabilitada(),
  }
}
