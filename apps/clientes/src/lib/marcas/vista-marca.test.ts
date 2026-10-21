import { describe, expect, it } from "vitest";
import type { PaginaMarca } from "./pagina-marca";
import {
  filtrosDeMarca,
  hrefCatalogoCompleto,
  hrefLinea,
  leerEstadoMarca,
  metadataMarca,
  rutasSitemapMarcas,
} from "./vista-marca";

const lineas = {
  items: [{ slug: "piscinas", titulo: "Piscinas", categorias: ["Piscinas"], skus: ["P1"] }],
};

function pagina(extra: Partial<PaginaMarca> = {}): PaginaMarca {
  return {
    slug: "led-premium",
    nombre: "Led Premium",
    nivel: "oficial",
    publicada: true,
    orden: 1,
    marcasCatalogo: ["LED PREMIUM", "Led Premium"],
    bajada: "Fabricantes de iluminación LED profesional.",
    logo: "/images/marcas/acme.webp",
    bloques: { lineas },
    visibilidad: {},
    ...extra,
  };
}

describe("metadataMarca", () => {
  it("título de tienda oficial, descripción y canonical", () => {
    const m = metadataMarca(pagina(), "Central Led", false);
    expect(m.title).toEqual({ absolute: "Led Premium — Tienda oficial | Central Led" });
    expect(m.description).toBe("Fabricantes de iluminación LED profesional.");
    expect(m.alternates?.canonical).toBe("/marcas/led-premium");
    expect(m.robots).toBeUndefined();
    expect(m.openGraph?.images).toEqual(["/images/marcas/acme.webp"]);
  });

  it("nivel marca sin 'Tienda oficial'; el SEO propio gana", () => {
    expect(metadataMarca(pagina({ nivel: "marca" }), "Central Led", false).title).toEqual({
      absolute: "Led Premium | Central Led",
    });
    const m = metadataMarca(pagina({ seo: { titulo: "Propio", descripcion: "Desc" } }), "Central Led", false);
    expect(m.title).toEqual({ absolute: "Propio" });
    expect(m.description).toBe("Desc");
  });

  it("con query: noindex, follow", () => {
    expect(metadataMarca(pagina(), "Central Led", true).robots).toEqual({ index: false, follow: true });
  });
});

describe("filtros y estado", () => {
  it("filtrosDeMarca usa los valores crudos y nunca filtra stock", () => {
    const f = filtrosDeMarca(pagina());
    expect(f).toEqual({ marcasPropias: ["LED PREMIUM", "Led Premium"] });
    expect("soloStock" in f).toBe(false);
  });

  it("con una línea existente la suma; con una desconocida no", () => {
    expect(filtrosDeMarca(pagina(), "piscinas").linea).toEqual({ categorias: ["Piscinas"], skus: ["P1"] });
    expect(filtrosDeMarca(pagina(), "nada").linea).toBeUndefined();
  });

  it("leerEstadoMarca acota la página y valida la línea", () => {
    expect(leerEstadoMarca({ pagina: "0" }, pagina())).toEqual({ pagina: 1 });
    expect(leerEstadoMarca({ pagina: "3", linea: "piscinas" }, pagina())).toEqual({ pagina: 3, linea: "piscinas" });
    expect(leerEstadoMarca({ pagina: "x", linea: "otra" }, pagina())).toEqual({ pagina: 1 });
    expect(leerEstadoMarca({ pagina: ["2", "5"] }, pagina())).toEqual({ pagina: 2 });
  });
});

describe("hrefs", () => {
  it("hrefLinea va al bloque de productos", () => {
    expect(hrefLinea("led-premium", "piscinas")).toBe("/marcas/led-premium?linea=piscinas#productos");
    expect(hrefLinea("led-premium")).toBe("/marcas/led-premium#productos");
  });

  it("hrefCatalogoCompleto repite ?marca= por cada valor", () => {
    expect(hrefCatalogoCompleto(pagina())).toBe("/catalogo?marca=LED+PREMIUM&marca=Led+Premium");
  });
});

describe("rutasSitemapMarcas", () => {
  it("sin publicadas no agrega nada; con publicadas, el índice y cada una", () => {
    expect(rutasSitemapMarcas([])).toEqual([]);
    expect(rutasSitemapMarcas([pagina({ publicada: false })])).toEqual([]);
    expect(rutasSitemapMarcas([pagina()])).toEqual(["/marcas", "/marcas/led-premium"]);
  });
});
