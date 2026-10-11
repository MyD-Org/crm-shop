// Máquina de estados de marketing_piezas (spec, "Máquina de estados"). Cada actor sólo puede
// mover una pieza por las aristas de SU fila: así el studio no aprueba ni ai-api publica algo
// que la persona no aprobó.
export const ESTADOS_PIEZA = [
  "esperando_material",
  "borrador",
  "renderizando",
  "para_revisar",
  "cambios_pedidos",
  "aprobada",
  "programada",
  "publicada",
  "fallida",
  "descartada",
] as const
export type EstadoPieza = (typeof ESTADOS_PIEZA)[number]
export type ActorPieza = "usuario" | "planificador" | "studio" | "aiapi" | "sistema"

type Aristas = Partial<Record<EstadoPieza, readonly EstadoPieza[]>>

// `borrador → renderizando` no está en ninguna fila: sólo lo hace el claim atómico del repo.
const TRANSICIONES: Record<ActorPieza, Aristas> = {
  usuario: {
    esperando_material: ["borrador", "descartada"],
    borrador: ["descartada"],
    para_revisar: ["aprobada", "cambios_pedidos", "descartada"],
    cambios_pedidos: ["descartada"],
    aprobada: ["publicada", "descartada"],
    fallida: ["aprobada", "descartada"],
  },
  planificador: {
    cambios_pedidos: ["borrador"],
    esperando_material: ["borrador"],
  },
  studio: {
    renderizando: ["para_revisar", "cambios_pedidos"],
  },
  aiapi: {
    aprobada: ["programada"],
    programada: ["publicada", "fallida"],
    fallida: ["programada"],
  },
  sistema: {
    renderizando: ["borrador"],
  },
}

/** Estados desde los que el usuario puede editar contenido o caption (la pieza vuelve a borrador). */
export const ESTADOS_EDITABLES: readonly EstadoPieza[] = [
  "esperando_material",
  "borrador",
  "para_revisar",
  "cambios_pedidos",
  "aprobada",
  "fallida",
]

export function esEstadoPieza(v: unknown): v is EstadoPieza {
  return typeof v === "string" && (ESTADOS_PIEZA as readonly string[]).includes(v)
}

export function puedeTransicionar(actor: ActorPieza, de: EstadoPieza, a: EstadoPieza): boolean {
  return TRANSICIONES[actor][de]?.includes(a) ?? false
}
