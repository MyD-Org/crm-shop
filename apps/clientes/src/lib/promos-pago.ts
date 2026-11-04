/**
 * Promos de pago de la home ("Hasta 6 cuotas sin interés", "10 % de descuento pagando con
 * Transferencia"). Lógica PURA: arma los avisos con datos reales, nunca con texto fijo.
 *
 * - Cuotas: las de `mediosPrecio.cuotas` (las de Mercado Pago salen de su cuenta, #760; las de otros
 *   procesadores, de las condiciones del admin). Se anuncia la mayor cantidad ofrecida.
 * - Descuento: el del medio DESTACADO de las cards. El Shop no ve los coeficientes de las listas, así
 *   que el porcentaje se deduce de los productos: el que más se repite entre los que muestran el
 *   precio con ese medio (sin campaña). Si no hay uno que valga para la mayoría, se anuncia el medio
 *   sin porcentaje.
 *
 * Sin cuotas ni medio con descuento no hay avisos: la sección no se muestra.
 */
import type { PrecioMedio, Product } from "@/data/products";
import type { MedioCuotas } from "./cuotas-sin-interes";
import { fmtPrecioCorto } from "./format";
import type { MedioPrecio } from "./medios-precio";

export interface PromoPago {
  tipo: "cuotas" | "descuento";
  titulo: string;
  texto: string;
}

/** Nombre de la forma de pago en "pagando con …" (como en "$X con débito"). */
const ROTULO_FORMA: Record<NonNullable<PrecioMedio["forma"]>, string> = {
  credito: "tarjeta de crédito",
  debito: "tarjeta de débito",
  cuenta_mp: "dinero en cuenta de Mercado Pago",
};

/** Mínima cantidad de productos con precio del medio para deducir un porcentaje. */
const MIN_MUESTRA = 3;

/** La mayor cantidad de cuotas sin interés ofrecida, con su medio y el mínimo de compra más bajo. */
export function mejorCuotas(
  medios: readonly MedioCuotas[] | undefined,
): { cuotas: number; medio: string; minimo: number | null } | null {
  let mejor: { cuotas: number; medio: string; minimo: number | null } | null = null;
  for (const m of medios ?? []) {
    for (const c of m.condiciones) {
      if (!Number.isInteger(c.cuotas) || c.cuotas < 2) continue;
      const minimo = c.montoMinimo != null && c.montoMinimo > 0 ? c.montoMinimo : null;
      if (!mejor || c.cuotas > mejor.cuotas) {
        mejor = { cuotas: c.cuotas, medio: m.nombre, minimo };
      } else if (c.cuotas === mejor.cuotas && mejor.minimo !== null && (minimo === null || minimo < mejor.minimo)) {
        // Misma cantidad con un mínimo menor (o sin mínimo): se anuncia la condición más accesible.
        mejor = { cuotas: c.cuotas, medio: m.nombre, minimo };
      }
    }
  }
  return mejor;
}

/**
 * Descuento del medio destacado deducido de los productos: el porcentaje entero que más se repite,
 * si lo comparte al menos la mitad de la muestra. `null` = no se puede afirmar un porcentaje.
 * `hay` = algún producto muestra un precio menor con el medio.
 */
export function descuentoDelMedio(
  productos: readonly Product[],
  slug: string,
): { hay: boolean; porcentaje: number | null; forma?: PrecioMedio["forma"] } {
  const conteo = new Map<number, number>();
  let muestra = 0;
  let forma: PrecioMedio["forma"];
  for (const p of productos) {
    const pm = p.precioMedio;
    // Con campaña el precio de la card no es el de lista: no sirve para comparar.
    if (!pm || pm.slug !== slug || p.campania || !(p.price > 0) || !(pm.price < p.price)) continue;
    const pct = Math.round((1 - pm.price / p.price) * 100);
    if (pct < 1) continue;
    muestra += 1;
    conteo.set(pct, (conteo.get(pct) ?? 0) + 1);
    forma ??= pm.forma;
  }
  if (muestra === 0) return { hay: false, porcentaje: null };
  const [pct, veces] = [...conteo].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const porcentaje = muestra >= MIN_MUESTRA && veces * 2 >= muestra ? pct : null;
  return { hay: true, porcentaje, ...(forma ? { forma } : {}) };
}

/** Los avisos de la sección, en orden: cuotas y descuento. Vacío = la sección no se muestra. */
export function promosPago(args: {
  cuotas?: readonly MedioCuotas[];
  destacado?: MedioPrecio | null;
  productos: readonly Product[];
}): PromoPago[] {
  const avisos: PromoPago[] = [];

  const c = mejorCuotas(args.cuotas);
  if (c) {
    avisos.push({
      tipo: "cuotas",
      titulo: `Hasta ${c.cuotas} cuotas sin interés`,
      texto: `Con tarjeta de crédito a través de ${c.medio}.${c.minimo ? ` En compras desde ${fmtPrecioCorto(c.minimo)}.` : ""}`,
    });
  }

  if (args.destacado) {
    const d = descuentoDelMedio(args.productos, args.destacado.slug);
    if (d.hay) {
      const con = d.forma ? ROTULO_FORMA[d.forma] : args.destacado.nombre;
      avisos.push(
        d.porcentaje !== null
          ? { tipo: "descuento", titulo: `${d.porcentaje} % de descuento`, texto: `Pagando con ${con}.` }
          : { tipo: "descuento", titulo: `Mejor precio con ${con}`, texto: `Vea el precio con ${con} en cada producto.` },
      );
    }
  }

  return avisos;
}
