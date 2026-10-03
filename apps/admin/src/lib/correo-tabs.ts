import { resolveSelected, type CanalTab } from "@/lib/inbox-canales"

// Las casillas de correo son solapas dentro de Mensajes (/admin/inbox), junto a las de canal
// ("Todos", "Wsp Mdp", ...). Acá viven las claves y el armado de esas solapas (lógica pura).

export const PREFIJO_CASILLA = "correo:"

export interface CasillaTab {
  key: string
  casillaId: string
  label: string
  noLeidos: number
}

export const casillaTabKey = (casillaId: string): string => `${PREFIJO_CASILLA}${casillaId}`
export const esTabCasilla = (key: string): boolean => key.startsWith(PREFIJO_CASILLA)
export const casillaIdDeTab = (key: string): string | null => (esTabCasilla(key) ? key.slice(PREFIJO_CASILLA.length) : null)

/** Una solapa por casilla accesible y activa (el servidor ya filtró): nombre visible o el email. */
export function buildCasillaTabs(
  casillas: { id: string; nombre: string; email: string }[],
  noLeidosPorCasilla: Record<string, number>,
): CasillaTab[] {
  return casillas.map((c) => ({
    key: casillaTabKey(c.id),
    casillaId: c.id,
    label: c.nombre.trim() || c.email,
    noLeidos: noLeidosPorCasilla[c.id] ?? 0,
  }))
}

/** La selección guardada solo vale si esa solapa (de canal o de casilla) sigue existiendo. */
export function resolveSelectedConCasillas(selected: string, canales: CanalTab[], casillas: CasillaTab[]): string {
  if (esTabCasilla(selected)) return casillas.some((c) => c.key === selected) ? selected : resolveSelected("", canales)
  return resolveSelected(selected, canales)
}
