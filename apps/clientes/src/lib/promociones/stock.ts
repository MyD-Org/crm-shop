import { leerDisponibilidadBruta, type DisponibilidadBruta } from "@/lib/stock-sucursal";
import type { SucursalDato } from "@/lib/sucursales";

/**
 * Stock de la promo por sucursal (spec 2026-10-26-promociones-home §3): el contador de unidades
 * mira UNA sucursal, no el agregado de `dispCatalogo` (que toma el máximo entre locales).
 */

/** Disponible (stock − reservado, piso 0) en `sucursal`. Sin fila = 0; no inventariable = null. */
export function disponibleEnSucursal(
  bruta: DisponibilidadBruta,
  ids: string[],
  sucursal: string,
): Record<string, number | null> {
  const salida: Record<string, number | null> = {};
  for (const id of ids) {
    const porSucursal = bruta.stockPorSucursal[id];
    if (porSucursal === null) {
      salida[id] = null;
      continue;
    }
    const stock = porSucursal?.[sucursal] ?? 0;
    const reservado = bruta.reservadoPorSucursal[id]?.[sucursal] ?? 0;
    salida[id] = Math.max(0, stock - reservado);
  }
  return salida;
}

/** Sin caché: son uno o pocos ids por vista. `stockHeredado` = la sucursal predeterminada. */
export async function stockEnSucursal(
  ids: string[],
  sucursal: string,
  stockHeredado: string,
): Promise<Record<string, number | null>> {
  if (ids.length === 0) return {};
  const bruta = await leerDisponibilidadBruta(ids, [sucursal], stockHeredado);
  return disponibleEnSucursal(bruta, ids, sucursal);
}

export type SucursalPromo = { slug: string; nombre: string; predeterminada: boolean };

/** Activas, por `orden` (y slug); la primera es la predeterminada, como en `disponibilidadDe`. */
export function sucursalesDePromo(sucursales: (Pick<SucursalDato, "slug" | "activa" | "orden"> & { nombre: string })[]): SucursalPromo[] {
  return sucursales
    .filter((s) => s.activa)
    .sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug))
    .map((s, i) => ({ slug: s.slug, nombre: s.nombre, predeterminada: i === 0 }));
}
