import { describe, expect, it } from "vitest";
import { metadataProducto } from "./producto-metadata";
import type { Product } from "@/data/products";
import { fmtPrecio } from "@/lib/format";

const base: Product = {
  id: "42",
  name: "LAMPARA LED A60 9W",
  brand: "Marca",
  price: 1000,
  stock: "in",
  sku: "02141N",
};

describe("metadataProducto", () => {
  it("título y descripción para la vista previa del link (el título se formatea, sólo para mostrar)", () => {
    const m = metadataProducto(base, false, "Tienda Uno");
    expect(m.title).toBe("Lampara LED A60 9W");
    const descripcion = `${fmtPrecio(1000)} · Marca · Código 02141N`;
    expect(m.description).toBe(descripcion);
    expect(m.openGraph).toMatchObject({ title: "Lampara LED A60 9W", description: descripcion });
  });

  it("si el nombre es sólo un código, el título lleva la marca (\"1200\" solo no dice nada al compartir el link)", () => {
    const m = metadataProducto({ ...base, name: "1200", brand: "AKAI", sku: "1200-AKAI" }, false, "Tienda Uno");
    expect(m.title).toBe("Akai 1200");
    expect(m.openGraph).toMatchObject({ title: "Akai 1200" });
  });

  it("el precio de la descripción es el final con IVA, como la card y el JSON-LD", () => {
    const m = metadataProducto({ ...base, precioFinal: 1210 }, false, "Tienda Uno");
    expect(m.description).toBe(`${fmtPrecio(1210)} · Marca · Código 02141N`);
  });

  it("sin precio publicado (\"Consulte el precio\") no muestra ninguno", () => {
    expect(metadataProducto({ ...base, price: 0 }, false, "Tienda Uno").description).toBe("Marca · Código 02141N");
  });

  it("sin precio, marca ni código no inventa descripción", () => {
    expect(metadataProducto({ ...base, price: 0, brand: "", sku: undefined }, false, "Tienda Uno").description).toBeUndefined();
  });

  it("repite el nombre del sitio y el idioma (el openGraph de la ficha reemplaza al del layout)", () => {
    expect(metadataProducto(base, false, "Tienda Uno").openGraph).toMatchObject({
      type: "website",
      siteName: "Tienda Uno",
      locale: "es_AR",
    });
  });

  it("usa la portada del overlay como imagen", () => {
    const m = metadataProducto(
      { ...base, images: [{ url: "https://media.plataforma.example/a.jpg", w: 1200 }] },
      false,
      "Tienda Uno",
    );
    expect(m.openGraph).toMatchObject({
      images: [{ url: "https://media.plataforma.example/a.jpg", width: 1200, alt: "Lampara LED A60 9W" }],
    });
  });

  it("sin fotos ni base no manda imagen", () => {
    expect(metadataProducto(base, false, "Tienda Uno").openGraph).not.toHaveProperty("images");
  });

  it("sin fotos y con base usa la imagen general del sitio", () => {
    expect(metadataProducto(base, true, "Tienda Uno").openGraph).toMatchObject({
      images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
    });
  });

  it("canonical y og:url solo con base configurada", () => {
    expect(metadataProducto(base, false, "Tienda Uno").alternates).toBeUndefined();
    const m = metadataProducto(base, true, "Tienda Uno");
    expect(m.alternates).toEqual({ canonical: "/producto/42" });
    expect(m.openGraph).toMatchObject({ url: "/producto/42" });
  });
});
