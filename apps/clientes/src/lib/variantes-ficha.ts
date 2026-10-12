/**
 * Piezas puras del selector de variantes (flag `variantes-selector`, change `variantes-de-producto`):
 * sin base ni React, para usarlas igual desde el servidor (resumen de las cards) y el navegador
 * (ficha y cards). Los textos visibles van en usted.
 */
import type { Product, ResumenVariantes } from "@/data/products";

/** Diferencia mínima (en pesos) para decir que dos precios difieren: absorbe el redondeo. */
const TOLERANCIA = 0.005;

/**
 * Resumen de un modelo a partir de los precios exhibidos de sus variantes activas con precio.
 * `undefined` = no es un modelo con varias opciones (0 o 1 variante). `desde` sólo si difieren.
 */
export function resumirVariantes(precios: readonly number[]): ResumenVariantes | undefined {
  if (precios.length < 2) return undefined;
  const min = Math.min(...precios);
  const max = Math.max(...precios);
  return max - min > TOLERANCIA ? { cantidad: precios.length, desde: min } : { cantidad: precios.length };
}

export const TEXTOS_VARIANTES = {
  /** El espejo no trae el nombre del atributo (Color, Largo…): el rótulo es siempre "Opción". */
  etiquetaSelector: "Opción",
  sinStock: "Sin stock",
  noDisponible: "No disponible",
  opciones: (n: number) => `${n} opciones`,
  desdeEsteMonto: "Desde este precio",
} as const;

/**
 * Qué cambia en la card de un modelo: el precio que se muestra y la nota bajo el precio. Con precio
 * de lista privada de la cuenta (`precioCuenta === "privado"`) no se ofrece "Desde": el menor precio
 * público no es el que ve esa cuenta.
 */
export function vistaCardVariantes(p: Pick<Product, "variantes" | "precioFinal" | "price" | "precioCuenta">): {
  precio: number;
  nota?: string;
  /** Modelo con varias opciones: la card no agrega al carrito, lleva a la ficha a elegir. */
  multiple: boolean;
  /** Se muestra el menor precio del modelo (no el de la representante): sin medios ni cuotas de la representante. */
  esDesde: boolean;
} {
  const v = p.variantes;
  const base = p.precioFinal ?? p.price;
  if (!v) return { precio: base, multiple: false, esDesde: false };
  const esDesde = v.desde != null && p.precioCuenta !== "privado";
  return {
    precio: esDesde ? (v.desde as number) : base,
    nota: esDesde
      ? `${TEXTOS_VARIANTES.desdeEsteMonto} · ${TEXTOS_VARIANTES.opciones(v.cantidad)}`
      : TEXTOS_VARIANTES.opciones(v.cantidad),
    multiple: true,
    esDesde,
  };
}

/** Ruta de la ficha de una variante (el id sintético `mdp:12` va codificado). */
export const rutaFichaVariante = (id: string): string => `/producto/${encodeURIComponent(id)}`;
