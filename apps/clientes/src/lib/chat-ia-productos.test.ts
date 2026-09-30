import { describe, expect, it } from "vitest";
import type { Product } from "@/data/products";
import {
  aProductoAgente,
  aProductoResuelto,
  DESCRIPCION_MAX,
  facetasDeProductos,
  limiteBusqueda,
  lineasAItems,
} from "./chat-ia-productos";

const base: Product = {
  id: "1101",
  name: "Reflector LED 50W IP65",
  brand: "Marca Demo",
  price: 10000,
  precioFinal: 12100,
  stock: "in",
  category: "Exterior",
  description: "Reflector para exterior",
  images: [{ url: "https://cliente.example/foto.jpg", w: 800 }],
};

describe("aProductoAgente", () => {
  it("forma compacta con precio final y stock en palabras", () => {
    expect(aProductoAgente(base)).toEqual({
      id: "1101",
      nombre: "Reflector LED 50W IP65",
      marca: "Marca Demo",
      categoria: "Exterior",
      precioReferencia: 12100,
      stock: "disponible",
      descripcion: "Reflector para exterior",
    });
    expect(aProductoAgente({ ...base, stock: "out" }).stock).toBe("sin stock");
    expect(aProductoAgente({ ...base, stock: "low" }).stock).toBe("pocas unidades");
  });

  it("recorta la descripción y omite los campos vacíos", () => {
    const larga = aProductoAgente({ ...base, description: "x ".repeat(500), brand: "", category: undefined });
    expect(larga.descripcion!.length).toBe(DESCRIPCION_MAX);
    expect(larga).not.toHaveProperty("marca");
    expect(larga).not.toHaveProperty("categoria");
    expect(aProductoAgente({ ...base, precioFinal: undefined }).precioReferencia).toBe(10000);
  });
});

describe("aProductoResuelto", () => {
  it("precio con IVA, foto de portada y disponible", () => {
    expect(aProductoResuelto(base)).toEqual({
      id: "1101",
      name: "Reflector LED 50W IP65",
      brand: "Marca Demo",
      imageUrl: "https://cliente.example/foto.jpg",
      price: 12100,
      available: true,
      maxQuantity: 999,
      attributes: ["Apto exterior"],
      precioNeto: 10000,
    });
  });

  it("código, atributos del diccionario y ficha técnica para la card spec", () => {
    const p = aProductoResuelto({
      ...base,
      name: "REFLECTOR LED 50W CALIDO",
      description: "Para exterior",
      sku: "RF-50-C",
      fichaTecnicaUrl: "https://cliente.example/fichas/rf-50.pdf",
    });
    expect(p).toMatchObject({
      code: "RF-50-C",
      attributes: ["Luz cálida", "Apto exterior"],
      specUrl: "https://cliente.example/fichas/rf-50.pdf",
    });
    const sinNada = aProductoResuelto({ ...base, name: "Cinta aisladora", description: undefined });
    expect(sinNada).not.toHaveProperty("attributes");
    expect(sinNada).not.toHaveProperty("specUrl");
    expect(sinNada).not.toHaveProperty("code");
  });

  it("código, tope de cantidad y aviso de stock bajo como la card del catálogo", () => {
    const p = aProductoResuelto({ ...base, sku: "BT-55-MCL", stock: "low", stockQty: 3 });
    expect(p).toMatchObject({ sku: "BT-55-MCL", maxQuantity: 3, stock: 3 });
    // Con stock alto no se avisa; el nombre que ya es el código no se repite.
    expect(aProductoResuelto({ ...base, stock: "in", stockQty: 40 })).toMatchObject({ maxQuantity: 40 });
    expect(aProductoResuelto({ ...base, stock: "in", stockQty: 40 })).not.toHaveProperty("stock");
    expect(aProductoResuelto({ ...base, sku: base.name })).not.toHaveProperty("sku");
  });

  it("sin stock o a $ 0 ⇒ no disponible; a $ 0 sin precio", () => {
    expect(aProductoResuelto({ ...base, stock: "out" }).available).toBe(false);
    const cero = aProductoResuelto({ ...base, price: 0, precioFinal: 0 });
    expect(cero.available).toBe(false);
    expect(cero).not.toHaveProperty("price");
  });
});

describe("limiteBusqueda", () => {
  it("acota a [1, 10] y cae al default con basura", () => {
    expect(limiteBusqueda(null)).toBe(8);
    expect(limiteBusqueda("abc")).toBe(8);
    expect(limiteBusqueda("0")).toBe(8);
    expect(limiteBusqueda("3")).toBe(3);
    expect(limiteBusqueda("500")).toBe(10);
  });
});

describe("lineasAItems", () => {
  const disponible = aProductoResuelto(base);
  const resueltos = new Map([
    ["1101", disponible],
    ["9", { ...disponible, id: "9", available: false }],
  ]);

  it("usa el precio neto y descarta lo no disponible o no resuelto", () => {
    expect(lineasAItems([{ id: "1101", qty: 3 }, { id: "9", qty: 1 }, { id: "404", qty: 2 }], resueltos)).toEqual([
      {
        item: { id: "1101", name: "Reflector LED 50W IP65", brand: "Marca Demo", price: 10000, image: "https://cliente.example/foto.jpg" },
        qty: 3,
      },
    ]);
  });
});

describe("facetasDeProductos", () => {
  const productos: Product[] = [
    { ...base, id: "1", name: "REFLECTOR LED 50W CALIDO", brand: "GENROD", category: "ILUMINACION", categoriaPropiaId: "c1" },
    { ...base, id: "2", name: "REFLECTOR 30W IP66 FRIO", brand: "GENROD", category: "ILUMINACION", categoriaPropiaId: "c1" },
    { ...base, id: "3", name: "PROYECTOR 100W", brand: "MACROLED", category: "ILUMINACION", categoriaPropiaId: "c2", description: undefined },
  ];

  it("con árbol propio: categorías por el nombre de la categoría propia; marcas y atributos sin repetidos", () => {
    const f = facetasDeProductos(productos, new Map([["c1", "REFLECTORES"], ["c2", "Proyectores"]]));
    expect(f.categorias).toEqual([
      { id: "REFLECTORES", nombre: "Reflectores" },
      { id: "Proyectores", nombre: "Proyectores" },
    ]);
    expect(f.marcas.map((m) => m.id)).toEqual(["GENROD", "MACROLED"]);
    expect(f.atributos).toEqual([
      { id: "tono-calido", nombre: "Luz cálida" },
      { id: "apto-exterior", nombre: "Apto exterior" },
      { id: "tono-frio", nombre: "Luz fría" },
    ]);
  });

  it("sin árbol: la categoría de Alegra (la que filtra el catálogo sin árbol)", () => {
    expect(facetasDeProductos(productos, new Map()).categorias).toEqual([{ id: "ILUMINACION", nombre: "Iluminación" }]);
  });
});

describe("fichas estructuradas (fase 2)", () => {
  const conAtributos: Product = {
    ...base,
    name: "REFLECTOR LED 50W",
    description: undefined,
    atributosEstructurados: {
      potencia_w: { n: 50, t: null },
      tono: { n: null, t: "calido" },
      ip: { n: 65, t: null },
      tension_v: { n: 220, t: "85-265" },
    },
  };

  it("ProductoAgente trae los atributos compactos; sin estructurados no aparece la clave", () => {
    expect(aProductoAgente(conAtributos).atributos).toEqual({ potencia_w: 50, tono: "calido", ip: 65, tension_v: "85-265" });
    expect(aProductoAgente(base)).not.toHaveProperty("atributos");
  });

  it("card spec: atributos del diccionario (estructurado primero) + valores técnicos", () => {
    expect(aProductoResuelto(conAtributos).attributes).toEqual([
      "Luz cálida",
      "Apto exterior",
      "220 V",
      "50 W",
      "IP65",
      "85–265 V",
    ]);
  });

  it("facetas del agente usan el dato estructurado", () => {
    const f = facetasDeProductos([conAtributos], new Map());
    expect(f.atributos.map((a) => a.id)).toEqual(["tono-calido", "apto-exterior", "tension-220v"]);
  });
});
