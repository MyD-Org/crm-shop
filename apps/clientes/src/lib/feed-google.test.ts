import { describe, expect, it } from "vitest";
import type { Product } from "@/data/products";
import { feedGoogleXml } from "./feed-google";

const base = {
  id: "42",
  name: "Lámpara LED 10W <fría> & cálida",
  brand: "Marca",
  price: 1000,
  precioFinal: 1210,
  stock: "in",
  sku: "LED-10",
  description: "  Una   lámpara  ",
  images: [{ url: "https://img.example/a.jpg" }, { url: "https://img.example/b.jpg" }],
} as unknown as Product;

const SITIO = "https://tienda.example";

describe("feedGoogleXml", () => {
  it("arma el item con precio final, link, fotos, marca y mpn", () => {
    const xml = feedGoogleXml([base], SITIO);
    expect(xml).toContain("<g:id>42</g:id>");
    expect(xml).toContain("<g:title>Lámpara LED 10W &lt;fría&gt; &amp; cálida</g:title>");
    expect(xml).toContain("<g:description>Una lámpara</g:description>");
    expect(xml).toContain("<g:link>https://tienda.example/producto/42</g:link>");
    expect(xml).toContain("<g:image_link>https://img.example/a.jpg</g:image_link>");
    expect(xml).toContain("<g:additional_image_link>https://img.example/b.jpg</g:additional_image_link>");
    expect(xml).toContain("<g:price>1210.00 ARS</g:price>");
    expect(xml).toContain("<g:availability>in_stock</g:availability>");
    expect(xml).toContain("<g:condition>new</g:condition>");
    expect(xml).toContain("<g:brand>Marca</g:brand>");
    expect(xml).toContain("<g:mpn>LED-10</g:mpn>");
  });

  it("sin foto o sin precio no entra (Google los rechaza)", () => {
    const xml = feedGoogleXml([{ ...base, images: [] }, { ...base, id: "7", price: 0 }], SITIO);
    expect(xml).not.toContain("<item>");
  });

  it("sin descripción usa el nombre; sin stock va agotado; sin marca ni código, identifier_exists no", () => {
    const xml = feedGoogleXml([{ ...base, description: undefined, stock: "out", brand: "", sku: undefined }], SITIO);
    expect(xml).toContain("<g:description>Lámpara LED 10W &lt;fría&gt; &amp; cálida</g:description>");
    expect(xml).toContain("<g:availability>out_of_stock</g:availability>");
    expect(xml).toContain("<g:identifier_exists>no</g:identifier_exists>");
    expect(xml).not.toContain("<g:brand>");
  });

  it("un modelo con variantes enlaza a la ficha de su representante", () => {
    const xml = feedGoogleXml([{ ...base, grupo: { representanteId: "40" } } as unknown as Product], SITIO);
    expect(xml).toContain("<g:link>https://tienda.example/producto/40</g:link>");
  });
});
