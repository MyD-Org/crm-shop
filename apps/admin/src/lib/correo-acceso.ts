import { adminNotFoundResponse } from "@/lib/admin-route-guard"
import { casillasDeUsuario, listarCasillas, type CasillaRow } from "@/lib/correo-repo"
import { roleRank } from "@/lib/roles"

// Quién puede ver qué casilla. Admin y superadmin ven TODAS las casillas activas del tenant sin
// necesitar fila de acceso; un operador solo las de su lista (correo_casilla_accesos) y activas.
// La autorización se decide acá, en el servidor, nunca desde el cliente.

export interface ActorCorreo {
  id: string
  role: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function casillasAccesibles(tenantId: string, actor: ActorCorreo): Promise<CasillaRow[]> {
  if (roleRank(actor.role) >= 1) return listarCasillas(tenantId, { soloActivas: true })
  return casillasDeUsuario(tenantId, actor.id)
}

/**
 * Resuelve una casilla a la que el actor tiene acceso. Sin acceso, inactiva, de otro tenant,
 * inexistente o con id mal formado: el MISMO 404 (sin oráculo de existencia).
 */
export async function requireCasilla(
  tenantId: string,
  actor: ActorCorreo,
  casillaId: string,
): Promise<{ ok: true; casilla: CasillaRow } | { ok: false; response: Response }> {
  if (!UUID.test(casillaId)) return { ok: false, response: adminNotFoundResponse() }
  const casilla = (await casillasAccesibles(tenantId, actor)).find((c) => c.id === casillaId)
  if (!casilla) return { ok: false, response: adminNotFoundResponse() }
  return { ok: true, casilla }
}
