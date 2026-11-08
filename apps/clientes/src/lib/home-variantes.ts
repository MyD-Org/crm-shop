/**
 * Migración de las imágenes de la home a la ruta con variantes
 * (`home/{tenant}/v/{uuid}-{800|1600}.webp`, ver `homeImagenKey`).
 *
 * Módulo PURO (sin R2 ni base): lo usa el script
 * `scripts/home-variantes-800.ts` y se testea aparte.
 */

/** URL vieja: `{base}/home/{tenant}/{uuid}-1600.webp` (una sola variante, sin `v/`). */
const URL_HOME_VIEJA =
  /^((?:.*\/)?)home\/([a-z0-9-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-1600\.webp$/i;

export interface PartesHomeVieja {
  /** Todo lo anterior a `home/` (incluye la barra final). */
  base: string;
  tenant: string;
  id: string;
}

/** Descompone una URL (o key) vieja de la home; null si no lo es (incluye las ya nuevas). */
export function parsearHomeVieja(valor: string): PartesHomeVieja | null {
  const m = URL_HOME_VIEJA.exec(valor);
  return m ? { base: m[1], tenant: m[2], id: m[3] } : null;
}

export function keyHomeNueva(p: Pick<PartesHomeVieja, "tenant" | "id">, ancho: 800 | 1600): string {
  return `home/${p.tenant}/v/${p.id}-${ancho}.webp`;
}

/** La key vieja (`home/{tenant}/{uuid}-1600.webp`) que corresponde a esas partes. */
export function keyHomeVieja(p: Pick<PartesHomeVieja, "tenant" | "id">): string {
  return `home/${p.tenant}/${p.id}-1600.webp`;
}

/** URL nueva (la de 1600) que reemplaza a una vieja. */
export function urlHomeNueva(p: PartesHomeVieja): string {
  return `${p.base}${keyHomeNueva(p, 1600)}`;
}

/**
 * Recorre un valor JSON y reemplaza, en cualquier profundidad, las strings que
 * SON una URL vieja de la home por la nueva (1600). No toca claves de objetos
 * ni strings que sólo contienen la URL. Devuelve una copia y la cantidad de
 * reemplazos; el original no se muta. `onUrl` se llama con cada URL vieja
 * encontrada (para juntar qué objetos hay que copiar).
 */
export function reescribirUrlsHome(
  valor: unknown,
  onUrl?: (partes: PartesHomeVieja) => void,
): { valor: unknown; cambios: number } {
  let cambios = 0;
  const visitar = (v: unknown): unknown => {
    if (typeof v === "string") {
      const partes = parsearHomeVieja(v);
      if (!partes) return v;
      cambios += 1;
      onUrl?.(partes);
      return urlHomeNueva(partes);
    }
    if (Array.isArray(v)) return v.map(visitar);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, visitar(x)]));
    }
    return v;
  };
  const salida = visitar(valor);
  return { valor: salida, cambios };
}
