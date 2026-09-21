import { describe, expect, it } from "vitest";
import type { SiteNavItem } from "@myd-org/ui";
import { conBadgeNav } from "./nav-badge";

function itemsNav(): SiteNavItem[] {
  return [
    { label: "Iluminación LED", href: `/catalogo?categoria=${encodeURIComponent("Iluminación LED")}` },
    { label: "Tableros", href: "/catalogo?categoria=Tableros" },
  ];
}

describe("conBadgeNav", () => {
  it("pega el texto al item cuya categoría coincide", () => {
    const out = conBadgeNav(itemsNav(), { categoria: "Tableros", texto: "Nuevo" });
    expect(out.find((i) => i.label === "Tableros")).toEqual({
      label: "Tableros",
      href: "/catalogo?categoria=Tableros",
      badge: "Nuevo",
    });
    expect(out.find((i) => i.label === "Iluminación LED")?.badge).toBeUndefined();
  });

  it("la categoría con caracteres especiales matchea por href", () => {
    const out = conBadgeNav(itemsNav(), { categoria: "Iluminación LED", texto: "Nuevo" });
    expect(out[0].badge).toBe("Nuevo");
    expect(out[1].badge).toBeUndefined();
  });

  it("no muta los items originales", () => {
    const items = itemsNav();
    conBadgeNav(items, { categoria: "Tableros", texto: "Nuevo" });
    expect(items).toEqual(itemsNav());
  });

  it("sin coincidencia deja el nav igual", () => {
    const items = itemsNav();
    expect(conBadgeNav(items, { categoria: "Inexistente", texto: "Nuevo" })).toEqual(items);
  });

  it("navBadge null deja el nav igual", () => {
    const items = itemsNav();
    expect(conBadgeNav(items, null)).toEqual(items);
  });
});
