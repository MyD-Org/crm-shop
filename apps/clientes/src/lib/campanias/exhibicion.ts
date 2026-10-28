/**
 * La campaña de un producto para EXHIBIRLO (catálogo, ficha, carruseles, favoritos). Usa la misma
 * regla que el cobro (`resolverPrecioVigente`), así lo exhibido y lo cobrado no se separan.
 */
import type { AlegraPrice } from "../alegra";
import type { CampaniaProducto } from "@/data/products";
import type { MediosPrecio } from "../medios-precio";
import { mapCampanias, resolverPrecioVigente, type EntradaCampania } from "./precio";

/** Los precios con los de campaña puestos en cada lista que la campaña trae (> 0). */
export function preciosConCampania(prices: AlegraPrice[], entrada: EntradaCampania): AlegraPrice[] {
  return prices.map((p) => {
    const c = entrada.precios.find((x) => x.idPriceList === p.idPriceList);
    return c && c.price > 0 ? { ...p, price: c.price } : p;
  });
}

/**
 * Con una campaña activa que alcanza al producto: los precios efectivos (los de campaña), el normal
 * que se tacha (neto, de la lista que rige) y los datos para el badge y la cuenta regresiva. `null`
 * = el producto se exhibe a su precio normal.
 */
export function campaniaParaExhibir(
  prices: AlegraPrice[],
  campaniasOnline: unknown,
  medios: Pick<MediosPrecio, "campanias" | "quedanCampania"> | undefined,
  idPriceList?: string,
): { precios: AlegraPrice[]; normal: number; campania: CampaniaProducto } | null {
  const activas = medios?.campanias;
  if (!activas?.length) return null;
  const quedan = new Map(Object.entries(medios?.quedanCampania ?? {}));
  const r = resolverPrecioVigente(prices, mapCampanias(campaniasOnline), { activas: new Set(activas.map((c) => c.id)), quedan }, { idListaMedio: idPriceList });
  const meta = r.campania ? activas.find((c) => c.id === r.campania!.id) : undefined;
  if (!r.campania || !meta || r.pct === null) return null;
  return {
    precios: preciosConCampania(prices, r.campania),
    normal: r.normal,
    campania: {
      id: meta.id,
      nombre: meta.nombre,
      etiqueta: meta.etiqueta,
      fin: meta.fin,
      pct: r.pct,
      unidades: r.campania.unidades,
      quedan: r.campania.unidades != null ? (quedan.get(r.campania.reglaId) ?? null) : null,
    },
  };
}
