"use client";

import { Breadcrumb } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import type { Miga } from "@/lib/mi-cuenta-nav";

/**
 * Breadcrumb de Mi cuenta. Lo renderizan las páginas del slot `@migas`: cada
 * sección arma sus migas (`migasMiCuenta`) y el detalle de un pedido le suma
 * el número. El último ítem, sin `href`, lleva `aria-current="page"`.
 */
export function MigasMiCuenta({ items }: { items: Miga[] }) {
  return <Breadcrumb ariaLabel="Migas de pan" items={items} renderLink={linkNext} />;
}
