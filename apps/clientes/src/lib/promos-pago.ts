/**
 * Promos de pago de la home ("Hasta 6 cuotas sin interés", "Grandes descuentos pagando con Transferencia").
 * Lógica PURA: arma los avisos con datos reales, nunca con texto fijo.
 *
 * - Cuotas: las de `mediosPrecio.cuotas` (las de Mercado Pago salen de su cuenta, #760; las de otros
 *   procesadores, de las condiciones del admin). Se anuncia la mayor cantidad ofrecida.
 * - Descuento: el del medio DESTACADO de las cards, si algún producto (sin campaña) muestra un precio
 *   menor con ese medio. No se anuncia porcentaje (decisión de la tienda): sólo que hay descuento.
 *
 * Los textos de las etiquetas se pueden reemplazar desde el editor de la home (`textos`); el número de
 * cuotas y el mínimo de compra no, porque son condiciones reales.
 *
 * Sin cuotas ni medio con descuento no hay avisos: la sección no se muestra.
 */
import type { PrecioMedio, Product } from "@/data/products";
import type { MedioCuotas } from "./cuotas-sin-interes";
import { fmtPrecioCorto } from "./format";
import type { MedioPrecio } from "./medios-precio";

export type PromoPago =
  | { tipo: "cuotas"; cuotas: number; titulo: string; texto: string }
  | { tipo: "descuento"; titulo: string; texto: string };

/** Nombre de la forma de pago en "pagando con …" (como en "$X con débito"). */
const ROTULO_FORMA: Record<NonNullable<PrecioMedio["forma"]>, string> = {
  credito: "tarjeta de crédito",
  debito: "tarjeta de débito",
  cuenta_mp: "dinero en cuenta de Mercado Pago",
};

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

/** Mayor descuento real (entero, hacia abajo) de los productos sin campaña con precio del medio. */
export function descuentoDelMedio(
  productos: readonly Product[],
  slug: string,
): { hay: boolean; maximo: number; forma?: PrecioMedio["forma"] } {
  let maximo = 0;
  let forma: PrecioMedio["forma"];
  for (const p of productos) {
    const pm = p.precioMedio;
    // Con campaña el precio de la card no es el de lista: no sirve para comparar.
    if (!pm || pm.slug !== slug || p.campania || !(p.price > 0) || !(pm.price < p.price)) continue;
    // +1e-9: que 0,2 no quede en 19 por el redondeo binario.
    const pct = Math.floor((1 - pm.price / p.price) * 100 + 1e-9);
    if (pct > maximo) maximo = pct;
    forma ??= pm.forma;
  }
  return { hay: maximo >= 1, maximo, ...(forma ? { forma } : {}) };
}

/** Cierra con punto, para que el mínimo de compra se lea como otra oración. */
const conPunto = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** Los avisos de la sección, en orden: cuotas y descuento. Vacío = la sección no se muestra. */
export function promosPago(args: {
  cuotas?: readonly MedioCuotas[];
  destacado?: MedioPrecio | null;
  productos: readonly Product[];
  textos?: { cuotasTexto?: string; descuentoTitulo?: string; descuentoTexto?: string };
}): PromoPago[] {
  const t = args.textos ?? {};
  const avisos: PromoPago[] = [];

  const c = mejorCuotas(args.cuotas);
  if (c) {
    avisos.push({
      tipo: "cuotas",
      cuotas: c.cuotas,
      titulo: `Hasta ${c.cuotas} cuotas sin interés`,
      texto: `${conPunto(t.cuotasTexto?.trim() || "Con tarjeta de crédito.")}${c.minimo ? ` En compras desde ${fmtPrecioCorto(c.minimo).replace(/\s/g, "\u00a0")}.` : ""}`,
    });
  }

  if (args.destacado) {
    const d = descuentoDelMedio(args.productos, args.destacado.slug);
    if (d.hay) {
      const con = d.forma ? ROTULO_FORMA[d.forma] : args.destacado.nombre;
      avisos.push({
        tipo: "descuento",
        titulo: t.descuentoTitulo?.trim() || "Grandes descuentos",
        texto: t.descuentoTexto?.trim() || `Pagando con ${con}.`,
      });
    }
  }

  return avisos;
}
