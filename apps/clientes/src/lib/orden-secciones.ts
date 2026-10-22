/**
 * Orden editable de secciones (home de la tienda y bloques de una página de marca). Módulo puro:
 * lo usan la lectura (servidor), las acciones y el diálogo "Ordenar secciones" (navegador).
 *
 * Lo guardado manda, pero nunca rompe la página: se descartan las desconocidas y las repetidas, y
 * una sección que no existía cuando se guardó el orden entra en su lugar de código (después de la
 * que la precede en el orden por defecto).
 */
export function completarOrden<T extends string>(guardado: unknown, defecto: readonly T[]): T[] {
  const validas = new Set<string>(defecto);
  const resultado: T[] = [];
  if (Array.isArray(guardado)) {
    for (const s of guardado) {
      if (typeof s === "string" && validas.has(s) && !resultado.includes(s as T)) resultado.push(s as T);
    }
  }
  defecto.forEach((s, i) => {
    if (resultado.includes(s)) return;
    const previa = defecto.slice(0, i).reverse().find((p) => resultado.includes(p));
    resultado.splice(previa === undefined ? 0 : resultado.indexOf(previa) + 1, 0, s);
  });
  return resultado;
}

/** Sube o baja una sección una posición (en los bordes no cambia). */
export function moverEnOrden<T>(orden: readonly T[], item: T, direccion: "arriba" | "abajo"): T[] {
  const i = orden.indexOf(item);
  const j = direccion === "arriba" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= orden.length) return [...orden];
  const copia = [...orden];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}

/** Error (en usted) de un orden que llega del editor, o `null`: tiene que ser una permutación exacta. */
export function errorOrden(raw: unknown, defecto: readonly string[]): string | null {
  if (!Array.isArray(raw) || raw.some((s) => typeof s !== "string")) return "El orden de las secciones no es válido.";
  const unicas = new Set(raw);
  if (unicas.size !== raw.length) return "El orden repite una sección.";
  if (raw.length !== defecto.length || raw.some((s) => !defecto.includes(s))) {
    return "El orden no coincide con las secciones de la página. Recargue e inténtelo de nuevo.";
  }
  return null;
}
