/**
 * Cupo de un alta masiva de favoritos. PURO: lo usa `agregarFavoritosLote`
 * (favoritos.ts) dentro de su transacción y se prueba sin base.
 */
export interface PlanLote {
  /** Ids a insertar, en el orden recibido. */
  aEscribir: string[];
  /** Cuántos de `nuevos` ya eran favoritos (no consumen cupo). */
  yaEstaban: number;
  /** Cuántos quedaron afuera por el tope. */
  sinLugar: number;
}

export function planificarLote(
  existentes: readonly string[],
  nuevos: readonly string[],
  max: number,
): PlanLote {
  const tiene = new Set(existentes);
  const vistos = new Set<string>();
  const faltantes: string[] = [];
  let yaEstaban = 0;
  for (const id of nuevos) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    if (tiene.has(id)) yaEstaban++;
    else faltantes.push(id);
  }
  const cupo = Math.max(0, max - tiene.size);
  return {
    aEscribir: faltantes.slice(0, cupo),
    yaEstaban,
    sinLugar: Math.max(0, faltantes.length - cupo),
  };
}
