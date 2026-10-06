import { Badge } from "@myd-org/ui";
import type { Product } from "@/data/products";

/**
 * Badge de la card: el de marketing si hay.
 */
export function badgeProducto(p: Product) {
  if (p.badgeText) return <Badge tone={p.badgeTone}>{p.badgeText}</Badge>;
  return undefined;
}
