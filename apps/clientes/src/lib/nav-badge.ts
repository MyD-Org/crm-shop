import type { SiteNavItem } from "@myd-org/ui";
import type { NavBadgeContent } from "@/data/home-defaults";

/**
 * Cuántas categorías entran en la barra del header. Lo comparten el header y
 * el editor del badge: el editor sólo ofrece las que de verdad se ven en el
 * menú, porque un badge sobre una categoría que no está ahí no aparece nunca.
 */
export const MAX_CATEGORIAS_NAV = 8;

/**
 * Forma de comparar categorías: sin tildes, sin espacios en los bordes y en
 * mayúsculas. El catálogo las guarda como "ILUMINACION" y el menú las muestra
 * como "Iluminación"; quien edita el badge escribe lo que ve.
 */
export function normalizarCategoria(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

/** La categoría de un item del nav, sacada de su href (`?categoria=…`). */
function categoriaDelItem(item: SiteNavItem): string | null {
  const query = item.href.split("?")[1];
  return query ? new URLSearchParams(query).get("categoria") : null;
}

/**
 * Pega `navBadge.texto` como badge del item del nav cuya categoría coincide con
 * `navBadge.categoria`. La comparación es por la categoría del href y
 * normalizada (ver `normalizarCategoria`): antes era exacta, así que
 * "Seguridad" no matcheaba con "SEGURIDAD" y el badge se guardaba sin error y
 * no aparecía en ningún lado. Sin coincidencia, o con `navBadge` null, el nav
 * queda exactamente igual.
 */
export function conBadgeNav(
  items: SiteNavItem[],
  navBadge: NavBadgeContent | null,
): SiteNavItem[] {
  if (!navBadge) return items;
  const buscada = normalizarCategoria(navBadge.categoria);
  return items.map((item) => {
    const categoria = categoriaDelItem(item);
    return categoria !== null && normalizarCategoria(categoria) === buscada
      ? { ...item, badge: navBadge.texto }
      : item;
  });
}
