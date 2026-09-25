/**
 * Arrastrar para cerrar la hoja de filtros (mobile): reglas del gesto, sin DOM.
 * El hook que las aplica está en src/components/catalogo/useArrastrarParaCerrar.ts.
 */

/** Recorrido mínimo, en px, antes de decidir si el gesto es vertical u horizontal. */
export const UMBRAL_INTENCION = 8;

/**
 * Tras soltar, ¿se cierra la hoja? Sí si se la bajó al menos un cuarto de su
 * alto (mínimo 80 px), o si se la tiró rápido hacia abajo (un "flick") aunque
 * el recorrido sea corto.
 *
 * @param desplazamiento px hacia abajo desde donde empezó el gesto.
 * @param alto alto de la hoja en px.
 * @param velocidad px/ms hacia abajo en el último tramo del gesto.
 */
export function debeCerrarHoja(desplazamiento: number, alto: number, velocidad: number): boolean {
  if (desplazamiento <= 0) return false;
  if (desplazamiento >= Math.max(80, alto * 0.25)) return true;
  return velocidad >= 0.5 && desplazamiento >= 30;
}

/**
 * ¿El gesto que arranca mueve la hoja o deja scrollear su contenido? Mueve la
 * hoja si empezó en el encabezado, o si el contenido ya está arriba de todo y
 * el dedo baja (como las hojas nativas). Hacia arriba o de costado, nunca.
 */
export function arrastraLaHoja({
  dx,
  dy,
  enEncabezado,
  scrollArriba,
}: {
  dx: number;
  dy: number;
  enEncabezado: boolean;
  scrollArriba: boolean;
}): boolean {
  if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) return false;
  return enEncabezado || scrollArriba;
}
