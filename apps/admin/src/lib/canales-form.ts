// Estado del selector "Canales con acceso" de la gestión de usuarios (components/admin/UserList.tsx),
// sin React, para poder testear el mapeo estado → payload del PATCH.
//   modo "todos"      ⇄ canales_permitidos = null   (todos los canales)
//   modo "seleccion"  ⇄ canales_permitidos = [...]  (solo esos; [] = ninguno)

export type CanalesModo = "todos" | "seleccion"

export interface CanalesForm {
  modo: CanalesModo
  seleccion: string[]
}

export const AVISO_SIN_CANALES = "Este usuario no podrá ver ninguna conversación."

export function canalesFormDesde(canales: string[] | null | undefined): CanalesForm {
  return canales == null ? { modo: "todos", seleccion: [] } : { modo: "seleccion", seleccion: [...canales] }
}

/** Valor para `canales_permitidos` del PATCH. */
export function canalesPayload(f: CanalesForm): string[] | null {
  return f.modo === "todos" ? null : f.seleccion
}

export function avisoCanales(f: CanalesForm): string | null {
  return f.modo === "seleccion" && f.seleccion.length === 0 ? AVISO_SIN_CANALES : null
}

export function badgeCanales(canales: string[] | null | undefined): string {
  if (canales == null) return "Todos"
  if (canales.length === 0) return "Sin canales"
  return canales.length === 1 ? "1 canal" : `${canales.length} canales`
}

/** ¿El formulario difiere del valor guardado? Comparación por conjunto. */
export function canalesSinGuardar(guardado: string[] | null | undefined, f: CanalesForm): boolean {
  const actual = canalesPayload(f)
  if (guardado == null || actual === null) return (guardado ?? null) !== actual
  if (guardado.length !== actual.length) return true
  const set = new Set(guardado)
  return actual.some((k) => !set.has(k))
}
