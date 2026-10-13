/**
 * Piezas puras del selector de variantes (flag `variantes-selector`, change `variantes-de-producto`):
 * sin base ni React, para usarlas igual desde el servidor (resumen de las cards) y el navegador
 * (ficha y cards). Los textos visibles van en usted.
 */
import type { Product, ResumenVariantes } from "@/data/products";

/** Cuántas etiquetas de opciones nombra la card; el resto va como "+N". */
export const MAX_ETIQUETAS_CARD = 3;

/** Diferencia mínima (en pesos) para decir que dos precios difieren: absorbe el redondeo. */
const TOLERANCIA = 0.005;

/**
 * Resumen de un modelo a partir de los precios exhibidos de sus variantes activas con precio.
 * `undefined` = no es un modelo con varias opciones (0 o 1 variante). `desde` sólo si difieren.
 */
export function resumirVariantes(
  precios: readonly number[],
  /** Etiquetas de las opciones, ya en orden natural (las que no tienen etiqueta no figuran). */
  etiquetas: readonly string[] = [],
): ResumenVariantes | undefined {
  if (precios.length < 2) return undefined;
  const min = Math.min(...precios);
  const max = Math.max(...precios);
  const primeras = etiquetas.slice(0, MAX_ETIQUETAS_CARD);
  return {
    cantidad: precios.length,
    ...(max - min > TOLERANCIA ? { desde: min } : {}),
    ...(primeras.length ? { etiquetas: primeras } : {}),
  };
}

/** "Blanco frío · Blanco cálido · Neutro +2": las primeras opciones y cuántas más hay. */
export function textoEtiquetasOpciones(v: Pick<ResumenVariantes, "cantidad" | "etiquetas">): string | undefined {
  const e = v.etiquetas;
  if (!e?.length) return undefined;
  const resto = v.cantidad - e.length;
  return resto > 0 ? `${e.join(" · ")} +${resto}` : e.join(" · ");
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
  /** Modelo con varias opciones: el botón de la card abre el panel para elegir una (no agrega directo). */
  multiple: boolean;
  /** Se muestra el menor precio del modelo (no el de la representante): sin medios ni cuotas de la representante. */
  esDesde: boolean;
} {
  const v = p.variantes;
  const base = p.precioFinal ?? p.price;
  if (!v) return { precio: base, multiple: false, esDesde: false };
  const esDesde = v.desde != null && p.precioCuenta !== "privado";
  // Con etiquetas, la card nombra las opciones; sin ellas (opciones sin etiqueta), la cantidad.
  const opciones = textoEtiquetasOpciones(v) ?? TEXTOS_VARIANTES.opciones(v.cantidad);
  return {
    precio: esDesde ? (v.desde as number) : base,
    nota: esDesde ? `${TEXTOS_VARIANTES.desdeEsteMonto} · ${opciones}` : opciones,
    multiple: true,
    esDesde,
  };
}

/** Ruta de la ficha de una variante (el id sintético `mdp:12` va codificado). */
export const rutaFichaVariante = (id: string): string => `/producto/${encodeURIComponent(id)}`;

/**
 * La opción que el panel «Agregar» de la card deja elegida: la que muestra la card (la representante)
 * si tiene stock; si no, la primera con stock; si ninguna tiene, la representante (se ve "Sin stock").
 * `null` sin opciones.
 */
export function opcionInicial<T extends { id: string; stock: Product["stock"] }>(
  opciones: readonly T[],
  idDeLaCard: string,
): T | null {
  const deLaCard = opciones.find((o) => o.id === idDeLaCard);
  if (deLaCard && deLaCard.stock !== "out") return deLaCard;
  return opciones.find((o) => o.stock !== "out") ?? deLaCard ?? opciones[0] ?? null;
}

export const TEXTOS_PANEL = {
  verDetalle: "Ver detalle",
  agregarAlCarrito: "Agregar al carrito",
  cargando: "Cargando opciones",
  error: "No se pudieron cargar las opciones.",
  reintentar: "Reintentar",
  sinPrecio: "Precio no disponible. Consulte por WhatsApp o por teléfono.",
  precioDeSuCuenta: "Precio de su cuenta",
  sinImpuestos: "precio sin impuestos nacionales",
  ayuda: "Elija una opción para agregarla a su carrito.",
} as const;
