/**
 * Nombre de una línea (carrito, cotización, pedido, favoritos) de un producto que es una variante de
 * un modelo (flag `variantes-selector`, change `variantes-de-producto`): "Modelo / Opción".
 *
 * Con el flag prendido el nombre exhibido de una variante sale del overlay del ANCLA del grupo, o sea
 * el del modelo ("Panel 18W"); la opción (la etiqueta del espejo: "Blanco frío") se suma acá, al
 * armar la línea. Puro y sin imports de base: lo usan el servidor y el navegador.
 */

const normalizado = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * `nombre` + " / " + `opcion`. Idempotente: si el nombre ya termina en la opción ("Panel 18W / Blanco
 * frío", cuando el modelo no tiene nombre curado y se usa el de Alegra de la variante) no la repite.
 * Sin opción, el nombre tal cual.
 */
export function nombreConOpcion(nombre: string, opcion?: string | null): string {
  const o = opcion?.trim();
  if (!o) return nombre;
  const n = normalizado(nombre);
  const op = normalizado(o);
  if (n === op || n.endsWith(`/ ${op}`)) return nombre;
  return `${nombre.trim()} / ${o}`;
}

/** El nombre de la línea de un producto del catálogo (`opcion` sólo viene con el flag prendido). */
export function nombreDeLinea(p: { name: string; opcion?: string | null }): string {
  return nombreConOpcion(p.name, p.opcion);
}
