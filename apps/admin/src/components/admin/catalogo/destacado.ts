// "Destacar en la categoría": la casilla y la posición del diálogo del producto se guardan en la
// columna existente `catalog_overlay.orden` (sin migración). null = sin destacar; menor número =
// primero; 9999 = destacado sin posición (el máximo que acepta la API). Módulo puro: lo usan el
// diálogo (cliente) y los tests, sin arrastrar drizzle al bundle.

/** `orden` de un producto destacado al que no se le indicó posición. */
export const ORDEN_DESTACADO_SIN_POSICION = 9999

const POSICION_MAX = ORDEN_DESTACADO_SIN_POSICION - 1

export const MSG_POSICION_INVALIDA = `Ingrese una posición entre 1 y ${POSICION_MAX}.`

export interface FormularioDestacado {
  destacado: boolean
  /** Texto del campo "Posición (opcional)"; vacío = sin posición. */
  posicion: string
}

export type ResultadoOrden = { ok: true; orden: number | null } | { ok: false; error: string }

/** Del valor guardado (`orden`) a lo que muestra el diálogo al abrirse. */
export function formularioDeOrden(orden: number | null): FormularioDestacado {
  if (orden === null) return { destacado: false, posicion: "" }
  if (orden === ORDEN_DESTACADO_SIN_POSICION) return { destacado: true, posicion: "" }
  return { destacado: true, posicion: String(orden) }
}

/** Del diálogo al valor que se manda en el PATCH (`orden`), validando la posición. */
export function ordenDeFormulario({ destacado, posicion }: FormularioDestacado): ResultadoOrden {
  if (!destacado) return { ok: true, orden: null }
  const texto = posicion.trim()
  if (texto === "") return { ok: true, orden: ORDEN_DESTACADO_SIN_POSICION }
  if (!/^\d+$/.test(texto)) return { ok: false, error: MSG_POSICION_INVALIDA }
  const n = Number(texto)
  if (n < 1 || n > POSICION_MAX) return { ok: false, error: MSG_POSICION_INVALIDA }
  return { ok: true, orden: n }
}
