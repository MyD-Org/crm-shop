// Estado del bloque "Secciones con acceso" de la gestión de usuarios (components/admin/UserList.tsx),
// sin React, para testear el mapeo estado -> payload del PATCH (patrón de canales-form.ts).
//   secciones null  ⇄ secciones_permitidas = NULL  (según el rol)
//   secciones [...] ⇄ lista explícita              ([] = ninguna sección de trabajo)
//   verCostos null  ⇄ ver_costos = NULL            (según el rol)
import {
  SECCIONES_TILDABLES,
  costosPorDefecto,
  normalizarSecciones,
  puedeVerCostos,
  puedeVerSeccion,
  seccionesPorDefecto,
  seccionesTrasCambioDeRol,
  verCostosTrasCambioDeRol,
  type ActorSecciones,
  type SeccionClave,
} from "@/lib/secciones"
import { validarTecho } from "@/lib/permisos-usuario"

export interface PermisosForm {
  secciones: SeccionClave[] | null
  verCostos: boolean | null
}

export const AVISO_SIN_SECCIONES = "Este usuario no verá ninguna sección de trabajo."
export const AVISO_LISTA_CONSERVADA = "Se conservó la lista de secciones; puede ajustarla."
export const MOTIVO_FUERA_DE_TECHO = "Usted no tiene acceso a esta sección, por eso no puede otorgarla."
export const MOTIVO_COSTOS_FUERA_DE_TECHO = "Usted no ve costos, por eso no puede otorgar este permiso."

/** Roles cuyo acceso se ajusta por sección. Superadmin y «compras» ignoran la lista. */
export function rolConSecciones(role: string): boolean {
  return role === "operator" || role === "admin"
}

export function permisosFormDesde(
  secciones: readonly string[] | null | undefined,
  verCostos: boolean | null | undefined,
): PermisosForm {
  return { secciones: secciones == null ? null : normalizarSecciones(secciones), verCostos: verCostos ?? null }
}

/** ¿Usa el default del rol en las dos columnas? */
export function segunElRol(f: PermisosForm): boolean {
  return f.secciones === null && f.verCostos === null
}

/** Casillas marcadas: la lista explícita o, si es NULL, el default del rol. */
export function seccionesMarcadas(f: PermisosForm, role: string): SeccionClave[] {
  return f.secciones ?? seccionesPorDefecto(role)
}

export function costosMarcado(f: PermisosForm, role: string): boolean {
  return f.verCostos ?? costosPorDefecto(role)
}

/** Tocar una casilla en modo "según el rol" pasa a lista explícita partiendo del default. */
export function alternarSeccion(f: PermisosForm, role: string, clave: SeccionClave): PermisosForm {
  const actuales = seccionesMarcadas(f, role)
  const nuevas = actuales.includes(clave) ? actuales.filter((c) => c !== clave) : [...actuales, clave]
  return { ...f, secciones: normalizarSecciones(nuevas) }
}

export function restablecerPermisos(): PermisosForm {
  return { secciones: null, verCostos: null }
}

/** Refleja en el editor la política del servidor al cambiar el rol (lib/secciones.ts). */
export function permisosTrasCambioDeRol(
  f: PermisosForm,
  rolAnterior: string,
  rolNuevo: string,
): { form: PermisosForm; aviso: string | null } {
  const secciones = seccionesTrasCambioDeRol(rolAnterior, rolNuevo, f.secciones)
  const verCostos = verCostosTrasCambioDeRol(rolAnterior, rolNuevo, f.verCostos)
  const conservada = rolAnterior !== rolNuevo && f.secciones !== null && secciones !== null
  return {
    form: { secciones: secciones == null ? null : normalizarSecciones(secciones), verCostos },
    aviso: conservada ? AVISO_LISTA_CONSERVADA : null,
  }
}

function mismasSecciones(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((k) => set.has(k))
}

/** ¿El formulario difiere de lo guardado? Listas por conjunto. */
export function permisosSinGuardar(original: PermisosForm, f: PermisosForm): boolean {
  return !mismasSecciones(original.secciones, f.secciones) || original.verCostos !== f.verCostos
}

/** Campos del PATCH: sólo los que cambiaron (null explícito = restablecer al rol). */
export function permisosPayload(
  original: PermisosForm,
  f: PermisosForm,
): { secciones_permitidas?: SeccionClave[] | null; ver_costos?: boolean | null } {
  const out: { secciones_permitidas?: SeccionClave[] | null; ver_costos?: boolean | null } = {}
  if (!mismasSecciones(original.secciones, f.secciones)) out.secciones_permitidas = f.secciones
  if (original.verCostos !== f.verCostos) out.ver_costos = f.verCostos
  return out
}

export function avisoPermisos(f: PermisosForm): string | null {
  return f.secciones !== null && f.secciones.length === 0 ? AVISO_SIN_SECCIONES : null
}

/** Texto corto para la tabla. */
export function badgePermisos(role: string, secciones: readonly string[] | null | undefined): string | null {
  if (!rolConSecciones(role)) return null
  if (secciones == null) return "Según el rol"
  const n = normalizarSecciones(secciones).length
  if (n === 0) return "Sin secciones"
  return n === 1 ? "1 sección" : `${n} secciones`
}

/** Casilla de una sección: deshabilitada si el actor no la tiene (salvo para quitarla). */
export function estadoCasilla(
  actor: ActorSecciones,
  clave: SeccionClave,
  marcada: boolean,
): { disabled: boolean; motivo: string | null } {
  if (actor.role === "superadmin" || marcada || puedeVerSeccion(actor, clave)) return { disabled: false, motivo: null }
  return { disabled: true, motivo: MOTIVO_FUERA_DE_TECHO }
}

export function estadoCasillaCostos(actor: ActorSecciones, marcada: boolean): { disabled: boolean; motivo: string | null } {
  if (marcada || puedeVerCostos(actor)) return { disabled: false, motivo: null }
  return { disabled: true, motivo: MOTIVO_COSTOS_FUERA_DE_TECHO }
}

/**
 * Error de techo que daría el servidor al guardar (mismo cálculo): para avisar antes, p. ej. si
 * "Restablecer al rol" o un cambio de rol suman secciones que el actor no tiene.
 */
export function errorTechoPermisos(
  actor: ActorSecciones,
  original: { role: string } & PermisosForm,
  rolNuevo: string,
  f: PermisosForm,
): string | null {
  if (!rolConSecciones(rolNuevo)) return null
  return validarTecho(
    actor,
    { role: original.role, seccionesPermitidas: original.secciones, verCostos: original.verCostos },
    { role: rolNuevo, seccionesPermitidas: f.secciones, verCostos: f.verCostos },
  )
}

/** Secciones tildables por grupo del menú, en orden de catálogo. */
export function seccionesPorGrupo(ocultas: readonly SeccionClave[] = []): { grupo: string; secciones: typeof SECCIONES_TILDABLES }[] {
  const grupos: { grupo: string; secciones: (typeof SECCIONES_TILDABLES)[number][] }[] = []
  for (const s of SECCIONES_TILDABLES) {
    if (ocultas.includes(s.clave)) continue
    const g = grupos.find((x) => x.grupo === s.grupo)
    if (g) g.secciones.push(s)
    else grupos.push({ grupo: s.grupo, secciones: [s] })
  }
  return grupos
}

/** Aclaraciones junto a algunas casillas. */
export const NOTA_SECCION: Partial<Record<SeccionClave, string>> = {
  catalogo: "Incluye la edición de precios.",
  pedidos: "Incluye datos de clientes.",
  comprobantes: "Incluye datos de clientes.",
}
