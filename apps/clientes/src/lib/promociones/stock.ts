import { leerDisponibilidadBruta, type DisponibilidadBruta } from "@/lib/stock-sucursal";
import type { SucursalDato } from "@/lib/sucursales";
import { sucursalesCacheadas } from "@/lib/sucursales-datos";
import { unidadesQuedan } from "./promo";
import type { EstrellaPromo } from "./tipos";

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

/**
 * Unidades que quedan según el stock de la sucursal de la promo (ver `unidadesQuedan`). Las
 * sucursales salen de la caché (el CRM la vence al guardar); el stock, sin caché.
 */
export async function quedanEstrella(e: EstrellaPromo, id: string): Promise<number | null> {
  try {
    const sucursales = sucursalesDePromo((await sucursalesCacheadas()).sucursales);
    const predeterminada = sucursales[0]?.slug;
    const sucursal = e.sucursal ?? predeterminada;
    if (!sucursal || !predeterminada) return null;
    const stock = (await stockEnSucursal([id], sucursal, predeterminada))[id];
    // No inventariable: sin ventas que descontar (el contador queda en el total).
    if (stock === null) return e.unidadesPromo ?? null;
    return unidadesQuedan(e, stock ?? 0);
  } catch (err) {
    console.error("[promociones] no se pudo leer el stock de la estrella:", err);
    return null;
  }
}
