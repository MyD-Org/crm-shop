import { describe, expect, it } from "vitest";
import { hrefCatalogo, leerEstado } from "@/lib/catalogo-url";
import { estadoCatalogoDeMarca, hrefMarcaConEstado, hrefMarcaDesdeCatalogo } from "./estado-marca";

/**
 * Filtros del catálogo dentro de una página de marca (`/marcas/<slug>`): el mismo estado que
 * `/catalogo` (categoría, precio, características, orden, vista, página), sin marca ni búsqueda, y
 * con "Solo con stock" APAGADO por defecto (la tienda de la marca muestra la línea completa).
 */
describe("estadoCatalogoDeMarca", () => {
  it("sin parámetros: todo apagado y sin stock forzado", () => {
    const e = estadoCatalogoDeMarca({});
    expect(e.soloStock).toBe(false);
    expect(e.marcas).toEqual([]);
    expect(e.query).toBeUndefined();
    expect(e.pagina).toBe(1);
  });

  it("lee categoría, precio, orden y página; ignora marca y búsqueda", () => {
    const e = estadoCatalogoDeMarca({
      categoria: "PISCINAS",
      precio_min: "1000",
      orden: "precio-asc",
      pagina: "2",
      marca: "OTRA",
      q: "foco",
      stock: "solo",
    });
    expect(e.categorias).toEqual(["PISCINAS"]);
    expect(e.precioMin).toBe(1000);
    expect(e.pagina).toBe(2);
    expect(e.marcas).toEqual([]);
    expect(e.query).toBeUndefined();
    expect(e.soloStock).toBe(true);
  });
});

describe("hrefMarcaConEstado", () => {
  it("sin filtros: la página de la marca a secas (o con la línea)", () => {
    expect(hrefMarcaConEstado("acme", estadoCatalogoDeMarca({}))).toBe("/marcas/acme");
    expect(hrefMarcaConEstado("acme", estadoCatalogoDeMarca({}), "piscinas")).toBe("/marcas/acme?linea=piscinas");
  });

  it("ida y vuelta: lo que se lee de la URL vuelve a la misma URL", () => {
    const href = hrefMarcaConEstado(
      "acme",
      { ...estadoCatalogoDeMarca({}), categorias: ["PISCINAS"], precioMax: 5000, soloStock: true, pagina: 3 },
      "piscinas",
    );
    expect(href).toBe("/marcas/acme?categoria=PISCINAS&precio_max=5000&stock=solo&pagina=3&linea=piscinas");
    const params = Object.fromEntries(new URL(href, "https://x.example").searchParams);
    expect(hrefMarcaConEstado("acme", estadoCatalogoDeMarca(params), params.linea)).toBe(href);
  });

  it("nunca lleva marca ni búsqueda", () => {
    const e = { ...estadoCatalogoDeMarca({}), marcas: ["OTRA"], query: "foco" };
    expect(hrefMarcaConEstado("acme", e)).toBe("/marcas/acme");
  });
});

describe("hrefMarcaDesdeCatalogo (la hoja de filtros de mobile arma hrefs de /catalogo)", () => {
  it("traduce el href del catálogo a la página de la marca, conservando la línea", () => {
    const estado = { ...estadoCatalogoDeMarca({}), categorias: ["PISCINAS"] };
    // Con stock apagado, el catálogo lo escribe como `stock=todos`; en la marca es el default.
    const deCatalogo = hrefCatalogo(estado);
    expect(leerEstado(Object.fromEntries(new URL(deCatalogo, "https://x.example").searchParams)).soloStock).toBe(false);
    expect(hrefMarcaDesdeCatalogo("acme", deCatalogo, "piscinas")).toBe("/marcas/acme?categoria=PISCINAS&linea=piscinas");
    expect(hrefMarcaDesdeCatalogo("acme", hrefCatalogo({ ...estado, soloStock: true }))).toBe(
      "/marcas/acme?categoria=PISCINAS&stock=solo",
    );
  });
});
