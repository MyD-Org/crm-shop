import { describe, expect, it } from "vitest";
import { jsonLdProducto, jsonLdProductoHtml } from "./producto-jsonld";
import type { Product } from "@/data/products";

const base: Product = {
  id: "42",
  name: "LAMPARA LED A60 9W",
  brand: "Marca",
  price: 1000,
  precioFinal: 1210,
  stock: "in",
  sku: "02141N",
};

describe("jsonLdProducto", () => {
  it("producto con precio: offers, sku/mpn, brand y disponibilidad", () => {
    const jsonLd = jsonLdProducto(base, undefined);
    expect(jsonLd["@type"]).toBe("Product");
    expect(jsonLd.name).toBe("LAMPARA LED A60 9W");
    expect(jsonLd.sku).toBe("02141N");
    expect(jsonLd.mpn).toBe("02141N");
    expect(jsonLd.brand).toEqual({ "@type": "Brand", name: "Marca" });
    expect(jsonLd.offers).toMatchObject({
      "@type": "Offer",
      price: 1210,
      priceCurrency: "ARS",
      availability: "https://schema.org/InStock",
    });
    expect(jsonLd.offers?.url).toBeUndefined();
  });

  it("sin precioFinal (sin IVA conocido) usa price a secas", () => {
    const jsonLd = jsonLdProducto({ ...base, precioFinal: undefined }, undefined);
    expect(jsonLd.offers?.price).toBe(1000);
  });

  it("sin precio publicado (price 0) no emite offers", () => {
    const jsonLd = jsonLdProducto({ ...base, price: 0, precioFinal: undefined }, undefined);
    expect(jsonLd.offers).toBeUndefined();
  });

  it("sin stock: OutOfStock", () => {
    const jsonLd = jsonLdProducto({ ...base, stock: "out" }, undefined);
    expect(jsonLd.offers?.availability).toBe("https://schema.org/OutOfStock");
  });

  it("bajo stock (low) sigue siendo InStock", () => {
    const jsonLd = jsonLdProducto({ ...base, stock: "low" }, undefined);
    expect(jsonLd.offers?.availability).toBe("https://schema.org/InStock");
  });

  it("sin NEXT_PUBLIC_SITE_URL no emite url", () => {
    expect(jsonLdProducto(base, undefined).offers?.url).toBeUndefined();
  });

  it("con NEXT_PUBLIC_SITE_URL arma la url absoluta (sin doble barra)", () => {
    const jsonLd = jsonLdProducto(base, "https://tienda.example/");
    expect(jsonLd.offers?.url).toBe("https://tienda.example/producto/42");
  });

  it("sin marca ni sku no manda esos campos", () => {
    const jsonLd = jsonLdProducto({ ...base, brand: "", sku: undefined }, undefined);
    expect(jsonLd.brand).toBeUndefined();
    expect(jsonLd.sku).toBeUndefined();
    expect(jsonLd.mpn).toBeUndefined();
  });

  it("fotos del overlay como image[] absolutas", () => {
    const jsonLd = jsonLdProducto(
      { ...base, images: [{ url: "https://media.plataforma.example/a.jpg", w: 1200 }] },
      undefined,
    );
    expect(jsonLd.image).toEqual(["https://media.plataforma.example/a.jpg"]);
  });

  it("sin fotos no manda image", () => {
    expect(jsonLdProducto(base, undefined).image).toBeUndefined();
  });

  it("category sólo si el producto la tiene", () => {
    expect(jsonLdProducto(base, undefined).category).toBeUndefined();
    expect(jsonLdProducto({ ...base, category: "ILUMINACION" }, undefined).category).toBe("ILUMINACION");
  });

  it("descripción: recorta espacios repetidos y la trunca a 500 caracteres", () => {
    const larga = "a".repeat(600);
    const jsonLd = jsonLdProducto({ ...base, description: `  ${larga}  \n con   espacios  ` }, undefined);
    expect(jsonLd.description?.length).toBeLessThanOrEqual(501); // 500 + "…"
    expect(jsonLd.description?.endsWith("…")).toBe(true);
  });

  it("sin descripción no manda el campo", () => {
    expect(jsonLdProducto({ ...base, description: "   " }, undefined).description).toBeUndefined();
  });
});

describe("jsonLdProductoHtml", () => {
  it("es JSON válido", () => {
    expect(() => JSON.parse(jsonLdProductoHtml(base, "https://tienda.example"))).not.toThrow();
  });

  it("escapa </script> reemplazando < por \\u003c", () => {
    const producto = { ...base, name: 'Producto </script><script>alert(1)</script>' };
    const html = jsonLdProductoHtml(producto, undefined);
    expect(html).not.toContain("</script>");
    expect(html).toContain("\\u003c/script>");
    // Sigue siendo JSON válido tras el escape.
    const parsed = JSON.parse(html);
    expect(parsed.name).toContain("</script>");
  });
});
