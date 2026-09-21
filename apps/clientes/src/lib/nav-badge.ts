import type { SiteNavItem } from "@myd-org/ui";
import type { NavBadgeContent } from "@/data/home-defaults";

/**
 * Pega `navBadge.texto` como badge del item del nav cuya categoría coincide con
 * `navBadge.categoria`. El href del nav se construye con
 * `encodeURIComponent(categoria)`, así que la comparación es por href: matchea
 * la categoría real aunque el label cambie. Sin coincidencia, o con
 * `navBadge` null, el nav queda exactamente igual.
 */
export function conBadgeNav(
  items: SiteNavItem[],
  navBadge: NavBadgeContent | null,
): SiteNavItem[] {
  if (!navBadge) return items;
  const href = `/catalogo?categoria=${encodeURIComponent(navBadge.categoria)}`;
  return items.map((item) =>
    item.href === href ? { ...item, badge: navBadge.texto } : item,
  );
}
