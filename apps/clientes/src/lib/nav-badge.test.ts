import { describe, expect, it } from "vitest";
import type { SiteNavItem } from "@myd-org/ui";
import { conBadgeNav, itemsNavHome, maxCategoriasNav, normalizarCategoria } from "./nav-badge";

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

  it("con visibleOn el badge lleva en qué tamaño se ve", () => {
    const out = conBadgeNav(itemsNav(), { categoria: "Tableros", texto: "Nuevo" }, "mobile");
    expect(out.find((i) => i.label === "Tableros")?.badgeVisibleOn).toBe("mobile");
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

describe("Marcas en el menú (spec 2026-10-20-marcas-tienda-oficial §8)", () => {
  const menu = [
    { label: "Acme", href: "/marcas/acme", destacado: true, descripcion: "Fábrica" },
    { label: "Ver todas las marcas", href: "/marcas" },
  ];
  const categorias = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

  it("con marcas entran 7 categorías; sin marcas, 8", () => {
    expect(maxCategoriasNav(true)).toBe(7);
    expect(maxCategoriasNav(false)).toBe(8);
  });

  it("sin páginas publicadas el menú queda como siempre", () => {
    const items = itemsNavHome(categorias, []);
    expect(items).toHaveLength(8);
    expect(items.some((i) => i.label === "Marcas")).toBe(false);
  });

  it("con páginas: 7 categorías y Marcas al final con su menú", () => {
    const items = itemsNavHome(categorias, menu);
    expect(items).toHaveLength(8);
    expect(items.at(-1)).toEqual({ label: "Marcas", href: "/marcas", menu });
    expect(items[0]).toEqual({ label: "A", href: "/catalogo?categoria=A" });
  });
});
