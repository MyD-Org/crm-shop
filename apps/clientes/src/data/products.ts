import Fuse from "fuse.js";
import type { ProductStock } from "@myd-org/ui";

export interface Product {
  id: string;
  name: string;
  brand: string;
  price: number;
  oldPrice?: number;
  discount?: string;
  stock: ProductStock;
  badgeTone?: "danger" | "info" | "warning" | "neutral";
  badgeText?: string;
}

export const PRODUCTS: Product[] = [
  {
    id: "1",
    name: "Lámpara LED 12W E27 luz fría",
    brand: "Macroled",
    price: 1890,
    stock: "in",
    badgeTone: "neutral",
    badgeText: "MÁS VENDIDO",
  },
  {
    id: "2",
    name: "Panel LED 48W 60×60 embutir",
    brand: "Macroled",
    price: 14990,
    oldPrice: 17900,
    discount: "-16%",
    stock: "in",
    badgeTone: "danger",
    badgeText: "OFERTA",
  },
  {
    id: "3",
    name: "Tira LED 5050 RGB 5m + control",
    brand: "Megalux",
    price: 8450,
    stock: "in",
    badgeTone: "info",
    badgeText: "NUEVO",
  },
  {
    id: "4",
    name: "Reflector LED 50W IP66 exterior",
    brand: "Macroled",
    price: 7250,
    oldPrice: 8990,
    discount: "-19%",
    stock: "low",
    badgeTone: "danger",
    badgeText: "OFERTA",
  },
  {
    id: "5",
    name: "Dicroica LED GU10 7W cálida",
    brand: "Osram",
    price: 5600,
    stock: "low",
  },
  {
    id: "6",
    name: "Plafón LED 24W redondo frío",
    brand: "Macroled",
    price: 8900,
    stock: "in",
  },
  {
    id: "7",
    name: "Cable unipolar 2.5mm² x 100m",
    brand: "Kalop",
    price: 45000,
    stock: "in",
    badgeTone: "warning",
    badgeText: "MÁS VENDIDO",
  },
  {
    id: "8",
    name: "Lámpara LED A60 12W E27 fría",
    brand: "Philips",
    price: 3200,
    stock: "in",
    badgeTone: "info",
    badgeText: "NUEVO",
  },
];

/** Quita acentos y pasa a minúsculas, para comparar sin importar tildes. */
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Pre-normalizamos para que Fuse compare sin acentos ni mayúsculas.
const PRODUCTS_NORMALIZED = PRODUCTS.map((p) => ({
  ...p,
  _name: normalize(p.name),
  _brand: normalize(p.brand),
}));

const fuseOptions = {
  keys: ["_name", "_brand"],
  ignoreLocation: true,
  minMatchCharLength: 3,
};

// Estricto: resultados con match claro.
const fuse = new Fuse(PRODUCTS_NORMALIZED, { ...fuseOptions, threshold: 0.2 });

// Permisivo: para sugerencias "¿Quisiste decir...?", tolera typos.
const fuseSuggest = new Fuse(PRODUCTS_NORMALIZED, { ...fuseOptions, threshold: 0.45 });

/**
 * Búsqueda tolerante a errores (acentos + typos) sobre nombre y marca.
 * Devuelve resultados ya rankeados por relevancia.
 */
export function searchProducts(query: string, limit = 6): Product[] {
  const q = normalize(query.trim());
  if (q.length < 2) return [];
  return fuse.search(q, { limit }).map((r) => r.item);
}

/**
 * Sugerencia tipo "¿quisiste decir...?" cuando no hay match exacto.
 * Devuelve el nombre del producto más parecido, o null si no hay nada cerca.
 */
export function suggestQuery(query: string): string | null {
  const q = normalize(query.trim());
  if (q.length < 3) return null;
  const [best] = fuseSuggest.search(q, { limit: 1 });
  if (!best) return null;
  return best.item.name;
}
