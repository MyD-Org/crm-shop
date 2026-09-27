import { Badge } from "@myd-org/ui";
import type { Product } from "@/data/products";

/**
 * Badge de la card: el de marketing si hay; si no, "Su precio" cuando se
 * muestra el precio especial de la cuenta (el de lista va tachado al lado).
 */
export function badgeProducto(p: Product) {
  if (p.badgeText) return <Badge tone={p.badgeTone}>{p.badgeText}</Badge>;
  if (p.precioEspecial) return <Badge tone="info">Su precio</Badge>;
  return undefined;
}
