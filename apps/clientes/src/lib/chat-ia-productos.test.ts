import { describe, expect, it } from "vitest";
import type { Product } from "@/data/products";
import { aProductoAgente, aProductoResuelto, DESCRIPCION_MAX, limiteBusqueda, lineasAItems } from "./chat-ia-productos";

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
      precioNeto: 10000,
    });
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
