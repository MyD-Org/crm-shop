// Validación de los permisos por sección de un usuario (`secciones_permitidas`, `ver_costos`) que
// fija la gestión de usuarios (PATCH/POST de /api/admin/usuarios). Sin I/O: las rutas leen la fila
// y llaman a estas funciones; así se testea sin DB. Spec `permisos-por-seccion`, dominio 6.
import {
  SECCIONES_TILDABLES,
  esSeccionClave,
  normalizarSecciones,
  puedeVerCostos,
  puedeVerSeccion,
  seccionesTrasCambioDeRol,
  verCostosTrasCambioDeRol,
  type ActorSecciones,
  type SeccionClave,
} from "@/lib/secciones"

export const ERROR_SECCION_NO_VALIDA = "Sección no válida."
export const ERROR_PROPIOS_PERMISOS = "No puede modificar sus propios permisos."
export const ERROR_TECHO_SECCIONES = "No puede otorgar secciones a las que usted no tiene acceso."
export const ERROR_TECHO_COSTOS = "No puede otorgar el permiso de ver costos porque usted no lo tiene."
export const ERROR_SUPERADMIN_TODO = "Los superadministradores tienen acceso a todo."
export const ERROR_COMPRAS_SOLO = "Este rol sólo accede a Compras."
export const ERROR_ULTIMO_GESTOR = "Debe quedar al menos un usuario con gestión de usuarios."

type Parse<T> = { ok: true; value: T } | { ok: false; error: string }

/** `secciones_permitidas` del cuerpo: null, o arreglo de claves tildables (normalizado y ordenado). */
export function parseSeccionesPermitidas(v: unknown): Parse<SeccionClave[] | null> {
  if (v === null) return { ok: true, value: null }
  if (!Array.isArray(v)) return { ok: false, error: ERROR_SECCION_NO_VALIDA }
  for (const k of v) {
    if (typeof k !== "string" || !esSeccionClave(k) || !SECCIONES_TILDABLES.some((s) => s.clave === k)) {
      return { ok: false, error: ERROR_SECCION_NO_VALIDA }
    }
  }
  return { ok: true, value: normalizarSecciones(v as string[]) }
}

/** `ver_costos` del cuerpo: null o boolean. */
export function parseVerCostos(v: unknown): Parse<boolean | null> {
  if (v === null || typeof v === "boolean") return { ok: true, value: v }
  return { ok: false, error: "El valor de «Ver costos» no es válido." }
}

/** Secciones TILDABLES que `u` ve con la política (las fijas dependen sólo del rol). */
function tildablesEfectivas(u: ActorSecciones): SeccionClave[] {
  return SECCIONES_TILDABLES.filter((s) => puedeVerSeccion(u, s.clave)).map((s) => s.clave)
}

/**
 * Techo del actor: no puede DAR acceso que él no tiene. Compara lo efectivo antes y después (así
 * cubre listas explícitas, «Restablecer al rol» y cambios de rol): cada sección que se suma debe
 * verla el actor, y si el objetivo pasa a ver costos el actor también debe verlos. Quitar siempre
 * está permitido. El superadmin no tiene techo. `antes` null = alta (no veía nada).
 */
export function validarTecho(
  actor: ActorSecciones,
  antes: ActorSecciones | null,
  despues: ActorSecciones,
): string | null {
  if (actor.role === "superadmin") return null
  const previas = new Set(antes ? tildablesEfectivas(antes) : [])
  const sumadas = tildablesEfectivas(despues).filter((c) => !previas.has(c))
  if (sumadas.some((c) => !puedeVerSeccion(actor, c))) return ERROR_TECHO_SECCIONES
  const costosAntes = antes ? puedeVerCostos(antes) : false
  if (!costosAntes && puedeVerCostos(despues) && !puedeVerCostos(actor)) return ERROR_TECHO_COSTOS
  return null
}

export interface PermisosObjetivo {
  role: string
  seccionesPermitidas: string[] | null
  verCostos: boolean | null
}

export interface CambioPermisos {
  rolNuevo: string
  /** undefined = el cuerpo no trae el campo. */
  secciones?: unknown
  verCostos?: unknown
}

/**
 * Valores de `secciones_permitidas` y `ver_costos` que quedan tras el PATCH: aplica primero la
 * política del cambio de rol (operator<->admin conserva lo explícito; hacia/desde superadmin o
 * compras pasa a NULL) y encima lo que mande el cuerpo. Valida claves, rol final y techo.
 */
export function resolverPermisos(
  actor: ActorSecciones,
  objetivo: PermisosObjetivo,
  cambio: CambioPermisos,
): Parse<{ seccionesPermitidas: string[] | null; verCostos: boolean | null }> {
  let secciones = seccionesTrasCambioDeRol(objetivo.role, cambio.rolNuevo, objetivo.seccionesPermitidas)
  let costos = verCostosTrasCambioDeRol(objetivo.role, cambio.rolNuevo, objetivo.verCostos)

  if (cambio.secciones !== undefined) {
    const p = parseSeccionesPermitidas(cambio.secciones)
    if (!p.ok) return p
    secciones = p.value
  }
  if (cambio.verCostos !== undefined) {
    const p = parseVerCostos(cambio.verCostos)
    if (!p.ok) return p
    costos = p.value
  }

  // Superadmin y «compras» ignoran las dos columnas: un valor explícito del cuerpo se rechaza y un
  // residuo cargado a mano se limpia (no bloquea, p. ej., un cambio de nombre).
  if (cambio.rolNuevo === "superadmin" || cambio.rolNuevo === "compras") {
    const explicito =
      (cambio.secciones !== undefined && secciones !== null) || (cambio.verCostos !== undefined && costos !== null)
    if (explicito) return { ok: false, error: cambio.rolNuevo === "superadmin" ? ERROR_SUPERADMIN_TODO : ERROR_COMPRAS_SOLO }
    secciones = null
    costos = null
  }

  const techo = validarTecho(actor, objetivo, { role: cambio.rolNuevo, seccionesPermitidas: secciones, verCostos: costos })
  if (techo) return { ok: false, error: techo }
  return { ok: true, value: { seccionesPermitidas: secciones, verCostos: costos } }
}

/**
 * Permisos de un usuario NUEVO (invitación): NULL (default del rol) salvo que el actor tenga techo;
 * entonces la lista queda en lo que el actor puede dar (intersección con el default del rol) y los
 * costos en false si el actor no los ve. Para superadmin/compras siempre NULL (ignoran la lista).
 * Si aun así el alta suma algo que el actor no tiene (rol «compras» sin la sección), devuelve error.
 */
export function permisosDeAlta(
  actor: ActorSecciones,
  rolNuevo: string,
): Parse<{ seccionesPermitidas: SeccionClave[] | null; verCostos: boolean | null }> {
  let secciones: SeccionClave[] | null = null
  let costos: boolean | null = null
  if (actor.role !== "superadmin" && (rolNuevo === "operator" || rolNuevo === "admin")) {
    const porDefecto = tildablesEfectivas({ role: rolNuevo, seccionesPermitidas: null })
    const dables = porDefecto.filter((c) => puedeVerSeccion(actor, c))
    if (dables.length !== porDefecto.length) secciones = dables
    if (puedeVerCostos({ role: rolNuevo }) && !puedeVerCostos(actor)) costos = false
  }
  const techo = validarTecho(actor, null, { role: rolNuevo, seccionesPermitidas: secciones, verCostos: costos })
  if (techo) return { ok: false, error: techo }
  return { ok: true, value: { seccionesPermitidas: secciones, verCostos: costos } }
}

/** ¿El rol gestiona usuarios? (admin y superadmin; misma regla que `canManageUsers`). */
export function esGestor(role: string): boolean {
  return role === "admin" || role === "superadmin"
}

export interface UsuarioGestion {
  id: string
  role: string
  /** Cuenta activa = ya creó su contraseña. */
  activo: boolean
}

/**
 * ¿Sigue quedando al menos un gestor activo en el tenant si `objetivoId` deja de serlo (cambio de
 * rol o baja)? `usuarios` = los del tenant. Si el objetivo no era gestor, no cambia nada.
 */
export function quedaGestor(usuarios: readonly UsuarioGestion[], objetivoId: string): boolean {
  const objetivo = usuarios.find((u) => u.id === objetivoId)
  if (!objetivo || !esGestor(objetivo.role)) return true
  return usuarios.some((u) => u.id !== objetivoId && u.activo && esGestor(u.role))
}
