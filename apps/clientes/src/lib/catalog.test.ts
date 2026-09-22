import { describe, expect, it } from "vitest";
import type { AlegraItem } from "./alegra";
import { mapFilaToProduct, mapItemToProduct } from "./catalog";

/**
 * `price` sigue siendo el NETO (lo usan carrito, AddToCartButton y cotización).
 * El precio final con IVA viaja aparte y sólo si hay IVA conocido.
 */

const fila = {
  alegraId: "7",
  name: "Lámpara",
  code: "LAM-1",
  description: null,
  brand: "Philips",
  prices: [
    { idPriceList: "1", name: "General", price: 100000, main: true },
    { idPriceList: "2", name: "Mayorista", price: 80000 },
  ],
  stock: "10",
  categoryName: "Iluminación",
  overlayNombre: null,
  overlayFotos: null,
};

describe("mapFilaToProduct (espejo)", () => {
  it("IVA 21%: precio neto intacto y precio final 121.000", () => {
    const p = mapFilaToProduct({ ...fila, ivaPorcentaje: "21.00" });
    expect(p.price).toBe(100000);
    expect(p.ivaPorcentaje).toBe(21);
    expect(p.precioFinal).toBe(121000);
  });

  it("IVA 10,5%: precio final 110.500", () => {
    const p = mapFilaToProduct({ ...fila, ivaPorcentaje: "10.50" });
    expect(p.precioFinal).toBe(110500);
  });

  it("cada lista de precios calcula su propio precio final", () => {
    const p = mapFilaToProduct({ ...fila, ivaPorcentaje: "21.00" }, "2");
    expect(p.price).toBe(80000);
    expect(p.precioFinal).toBe(96800);
  });

  it("sin IVA persistido no inventa precio final", () => {
    const p = mapFilaToProduct({ ...fila, ivaPorcentaje: null });
    expect(p.price).toBe(100000);
    expect(p.ivaPorcentaje).toBeUndefined();
    expect(p.precioFinal).toBeUndefined();
  });
});

describe("mapFilaToProduct: nombre, sku y fotos del overlay", () => {
  // En esta cuenta de Alegra `name` es el código y el nombre comercial vive en
  // `description`; el overlay del CRM puede pisar los dos.
  const base = {
    ...fila,
    ivaPorcentaje: null,
    name: "02141N",
    code: null,
    description: "LAMPARA LED A60 9W",
  };
  const HOST = "media.plataforma.example";
  const BASE = `https://${HOST}`;
  // El CRM guarda la key de R2; la URL se compone con la base pública.
  const foto = { key: "t1/a.jpg", w: 800, alt: "Lámpara" };

  it("el nombre del overlay gana; el código de Alegra queda como sku", () => {
    const p = mapFilaToProduct({ ...base, overlayNombre: "Lámpara LED A60" });
    expect(p.name).toBe("Lámpara LED A60");
    expect(p.sku).toBe("02141N");
  });

  it("sin overlay, el nombre es la descripción de Alegra", () => {
    const p = mapFilaToProduct({ ...base, description: "Cable unipolar" });
    expect(p.name).toBe("Cable unipolar");
  });

  it("un nombre de overlay vacío no pisa la descripción", () => {
    const p = mapFilaToProduct({ ...base, overlayNombre: "", description: "Cable unipolar" });
    expect(p.name).toBe("Cable unipolar");
  });

  it("sin overlay ni descripción cae al name de Alegra (y el sku también)", () => {
    const p = mapFilaToProduct({ ...base, description: "" });
    expect(p.name).toBe("02141N");
    expect(p.sku).toBe("02141N");
  });

  it("con reference en Alegra, el sku es la reference", () => {
    const p = mapFilaToProduct({ ...base, code: "REF-1" });
    expect(p.sku).toBe("REF-1");
  });

  it("sin fotos, images es undefined", () => {
    expect(mapFilaToProduct({ ...base, overlayFotos: null }, undefined, [HOST], BASE).images).toBeUndefined();
    expect(mapFilaToProduct({ ...base, overlayFotos: [] }, undefined, [HOST], BASE).images).toBeUndefined();
  });

  it("con fotos y host configurado, compone la url con la base y mapea w y alt", () => {
    const p = mapFilaToProduct({ ...base, overlayFotos: [foto] }, undefined, [HOST], BASE);
    expect(p.images).toEqual([{ url: `${BASE}/t1/a.jpg`, w: 800, alt: "Lámpara" }]);
  });

  it("con fotos pero sin host configurado, images es undefined (placeholder)", () => {
    const p = mapFilaToProduct({ ...base, overlayFotos: [foto] }, undefined, [], BASE);
    expect(p.images).toBeUndefined();
  });

  it("con fotos pero sin base pública configurada, images es undefined", () => {
    const p = mapFilaToProduct({ ...base, overlayFotos: [foto] }, undefined, [HOST], null);
    expect(p.images).toBeUndefined();
  });
});

describe("mapItemToProduct (ficha en vivo)", () => {
  const item: AlegraItem = {
    id: "7",
    name: "Lámpara",
    status: "active",
    price: [{ idPriceList: "1", price: 100000, main: true }],
  };

  it("usa el tax en vivo del ítem", () => {
    const p = mapItemToProduct({ ...item, tax: [{ percentage: "21.00" }] });
    expect(p.price).toBe(100000);
    expect(p.ivaPorcentaje).toBe(21);
    expect(p.precioFinal).toBe(121000);
  });

  it("nombre exhibido: la descripción de Alegra, igual que la card del catálogo", () => {
    const p = mapItemToProduct({ ...item, name: "02141N", description: "LAMPARA LED A60 9W" });
    expect(p.name).toBe("LAMPARA LED A60 9W");
  });

  it("sin descripción, el nombre es el name de Alegra", () => {
    expect(mapItemToProduct({ ...item, name: "02141N", description: "" }).name).toBe("02141N");
    expect(mapItemToProduct({ ...item, name: "02141N" }).name).toBe("02141N");
  });

  it("sku: la reference; si falta, el name de Alegra (el código no se pierde de la ficha)", () => {
    expect(mapItemToProduct({ ...item, name: "02141N", reference: "REF-1" }).sku).toBe("REF-1");
    expect(mapItemToProduct({ ...item, name: "02141N", description: "Lámpara" }).sku).toBe("02141N");
  });

  it("sin tax: misma regla que el espejo (sin default)", () => {
    const p = mapItemToProduct(item);
    expect(p.ivaPorcentaje).toBeUndefined();
    expect(p.precioFinal).toBeUndefined();
  });
});
