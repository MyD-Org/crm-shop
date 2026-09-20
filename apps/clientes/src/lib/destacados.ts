import type { Product } from "@/data/products";

/**
 * Elige los productos destacados de la home: primero los curados del CRM
 * (`skus`, comparando contra el SKU o el nombre de Alegra — el código vive
 * en cualquiera de los dos según el ítem), en el orden dado; después completa
 * con el resto del catálogo hasta `cantidad`. Así la home muestra siempre
 * productos reales con precio y cuotas vigentes, y el CRM controla cuáles
 * salen sin tocar código.
 */
export function elegirDestacados(
  pool: Product[],
  skus: string[],
  cantidad: number,
): Product[] {
  const normalizados = skus.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const coincide = (p: Product, sku: string) =>
    (p.sku ?? "").toUpperCase() === sku || p.name.toUpperCase() === sku;

  const elegidos: Product[] = [];
  for (const sku of normalizados) {
    const hit = pool.find((p) => coincide(p, sku) && !elegidos.some((e) => e.id === p.id));
    if (hit) elegidos.push(hit);
  }
  const resto = pool.filter((p) => !elegidos.some((e) => e.id === p.id));
  return [...elegidos, ...resto].slice(0, Math.max(1, cantidad));
}
