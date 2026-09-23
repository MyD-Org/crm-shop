import { describe, expect, it } from "vitest";
import { metadataProducto } from "./producto-metadata";
import type { Product } from "@/data/products";

const base: Product = {
  id: "42",
  name: "LAMPARA LED A60 9W",
  brand: "Marca",
  price: 1000,
  stock: "in",
  sku: "02141N",
};

describe("metadataProducto", () => {
  it("título y descripción para la vista previa del link", () => {
    const m = metadataProducto(base, false);
    expect(m.title).toBe("LAMPARA LED A60 9W");
    expect(m.description).toBe("Marca · Código 02141N");
    expect(m.openGraph).toMatchObject({ title: "LAMPARA LED A60 9W", description: "Marca · Código 02141N" });
  });

  it("sin marca ni código no inventa descripción", () => {
    expect(metadataProducto({ ...base, brand: "", sku: undefined }, false).description).toBeUndefined();
  });

  it("usa la portada del overlay como imagen", () => {
    const m = metadataProducto(
      { ...base, images: [{ url: "https://media.plataforma.example/a.jpg", w: 1200 }] },
      false,
    );
    expect(m.openGraph).toMatchObject({
      images: [{ url: "https://media.plataforma.example/a.jpg", width: 1200, alt: "LAMPARA LED A60 9W" }],
    });
  });

  it("sin fotos no manda imagen", () => {
    expect(metadataProducto(base, false).openGraph).not.toHaveProperty("images");
  });

  it("canonical y og:url solo con base configurada", () => {
    expect(metadataProducto(base, false).alternates).toBeUndefined();
    const m = metadataProducto(base, true);
    expect(m.alternates).toEqual({ canonical: "/producto/42" });
    expect(m.openGraph).toMatchObject({ url: "/producto/42" });
  });
});
