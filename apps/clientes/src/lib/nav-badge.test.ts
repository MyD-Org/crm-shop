import { describe, expect, it } from "vitest";
import type { SiteNavItem } from "@myd-org/ui";
import { conBadgeNav, normalizarCategoria } from "./nav-badge";

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

  it("matchea como se ve en el menú, no sólo como está guardada (el bug de \"Seguridad\")", () => {
    const items: SiteNavItem[] = [
      { label: "Iluminación", href: "/catalogo?categoria=ILUMINACION" },
      { label: "Seguridad", href: "/catalogo?categoria=SEGURIDAD" },
    ];
    expect(conBadgeNav(items, { categoria: "Seguridad", texto: "Nuevo" })[1].badge).toBe("Nuevo");
    expect(conBadgeNav(items, { categoria: "Iluminación", texto: "Nuevo" })[0].badge).toBe("Nuevo");
    expect(conBadgeNav(items, { categoria: " seguridad ", texto: "Nuevo" })[1].badge).toBe("Nuevo");
  });

  it("navBadge null deja el nav igual", () => {
    const items = itemsNav();
    expect(conBadgeNav(items, null)).toEqual(items);
  });
});

describe("normalizarCategoria", () => {
  it("saca tildes y espacios de los bordes y pasa a mayúsculas", () => {
    expect(normalizarCategoria("Iluminación")).toBe("ILUMINACION");
    expect(normalizarCategoria("  Seguridad ")).toBe("SEGURIDAD");
    expect(normalizarCategoria("ILUMINACION")).toBe("ILUMINACION");
  });
});
