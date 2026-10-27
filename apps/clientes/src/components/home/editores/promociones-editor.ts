import type { EstrellaPromo, PromocionesContent } from "@/data/home-defaults";

/**
 * Helpers puros del editor de promociones (spec 2026-10-26-promociones-home §3 y §7): el contador
 * de unidades necesita el stock del momento en que se cargaron (`stockBase`).
 */

/** Fija (o quita) las unidades de promo de la estrella junto con el stock de ese momento. */
export function aplicarUnidades(
  c: PromocionesContent,
  { unidades, stock, sucursal }: { unidades: number | undefined; stock: number | null; sucursal?: string },
): PromocionesContent {
  if (!c.estrella) return c;
  const resto: EstrellaPromo = { ...c.estrella };
  delete resto.unidadesPromo;
  delete resto.stockBase;
  if (!unidades) return { ...c, estrella: resto };
  // La sucursal se guarda con el stock base: si cambia la predeterminada, el contador no se mezcla.
  // Sin control de stock (null) el base es 0: la home lo detecta aparte y no descuenta unidades.
  return { ...c, estrella: { ...resto, unidadesPromo: unidades, stockBase: stock ?? 0, ...(sucursal ? { sucursal } : {}) } };
}

/** ¿Hay que volver a tomar el stock? Sí al cambiar estrella, sucursal o unidades, o si falta. */
export function necesitaStockBase(antes: EstrellaPromo | undefined, despues: EstrellaPromo | undefined): boolean {
  if (!despues?.unidadesPromo) return false;
  if (despues.stockBase === undefined) return true;
  if (!antes) return false;
  return antes.sku !== despues.sku || antes.sucursal !== despues.sucursal || antes.unidadesPromo !== despues.unidadesPromo;
}

/**
 * Cambio en la estrella. Otro producto arranca de cero (sólo conserva la sucursal): la referencia,
 * el video, los textos y el contador eran del anterior. Cambiar unidades o sucursal invalida el
 * stock base, que se vuelve a tomar.
 */
export function cambiarEstrella(e: EstrellaPromo | undefined, cambios: Partial<EstrellaPromo>): EstrellaPromo {
  if (cambios.sku !== undefined && cambios.sku !== e?.sku) return { sku: cambios.sku, ...(e?.sucursal ? { sucursal: e.sucursal } : {}) };
  const r: EstrellaPromo = { ...(e ?? { sku: "" }), ...cambios };
  if ("unidadesPromo" in cambios || "sucursal" in cambios) delete r.stockBase;
  return r;
}

/** Pesos enteros desde lo que escribe el admin: puntos de miles y coma decimal ("149.999,50" → 150000). */
export function enteroPesos(v: string): number | undefined {
  const limpio = v.replace(/[^\d.,]/g, "");
  if (!/\d/.test(limpio)) return undefined;
  const [entero, decimales] = limpio.replace(/\./g, "").split(",");
  const n = Math.round(Number(`${entero || "0"}.${decimales || "0"}`));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Completa el precio habitual (el que se tacha) con el precio de hoy en los productos que no lo
 * tienen. Se usa al agregar productos, ANTES de cargar el ajuste de promo en el CRM: después la
 * tienda ya sólo ve el precio rebajado. Sin cambios devuelve el mismo objeto.
 */
export function completarHabituales(c: PromocionesContent, precios: Record<string, number>): PromocionesContent {
  const clave = (sku: string) => sku.trim().toUpperCase();
  let cambio = false;
  const completar = <T extends { sku: string; precioHabitual?: number }>(i: T): T => {
    const hoy = precios[clave(i.sku)];
    if (i.precioHabitual !== undefined || !hoy) return i;
    cambio = true;
    return { ...i, precioHabitual: Math.round(hoy) };
  };
  const estrella = c.estrella ? completar(c.estrella) : undefined;
  const items = c.items.map(completar);
  return cambio ? { ...c, estrella, items } : c;
}
