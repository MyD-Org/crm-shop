import { describe, expect, it } from "vitest";
import type { Product } from "@/data/products";
import { aplicarEstadoPrecio, estadoDe, sesionPorCookie, type ValorCuenta } from "./precios-cuenta-estado";

const producto = {
  id: "1",
  name: "Panel",
  brand: "Marca",
  price: 1000,
  precioFinal: 1210,
  oldPrice: 1500,
  discount: "-20%",
  precioMedio: { slug: "transf", nombre: "Transferencia", price: 900 },
  preciosMedios: [{ slug: "transf", nombre: "Transferencia", price: 900 }],
  cuotasSinInteres: { medio: "Tarjeta", opciones: [] },
  stock: "in",
} as unknown as Product;

const vacio = new Map<string, ValorCuenta>();

describe("estadoDe", () => {
  it("visitante anónimo (sin sesión): nunca marcador, rige el público", () => {
    expect(estadoDe("1", vacio, { sinLista: false, sesion: false })).toBeUndefined();
  });

  it("con sesión y sin respuesta todavía: marcador (evita mostrar el público y cambiarlo)", () => {
    expect(estadoDe("1", vacio, { sinLista: false, sesion: true })).toEqual({ tipo: "pendiente" });
  });

  it("con sesión pero el servidor dijo que no tiene lista: público, sin marcador", () => {
    expect(estadoDe("1", vacio, { sinLista: true, sesion: true })).toBeUndefined();
  });

  it("con precio privado: ese precio", () => {
    const cache = new Map<string, ValorCuenta>([["1", { price: 700, precioFinal: 847 }]]);
    expect(estadoDe("1", cache, { sinLista: false, sesion: true })).toEqual({
      tipo: "privado",
      precio: { price: 700, precioFinal: 847 },
    });
  });

  it("sin precio en su lista: Consulte, aunque no haya sesión conocida", () => {
    const cache = new Map<string, ValorCuenta>([["1", null]]);
    expect(estadoDe("1", cache, { sinLista: false, sesion: false })).toEqual({ tipo: "consulte" });
  });

  it("si el overlay falló ('publico') el marcador no queda eterno", () => {
    const cache = new Map<string, ValorCuenta>([["1", "publico"]]);
    expect(estadoDe("1", cache, { sinLista: false, sesion: true })).toBeUndefined();
  });
});

describe("sesionPorCookie", () => {
  it("sin sesión (valor 0 o sin cookie)", () => {
    expect(sesionPorCookie("")).toBe(false);
    expect(sesionPorCookie("a=1; __client_uat=0; b=2")).toBe(false);
  });

  it("con sesión (timestamp), con o sin sufijo de instancia", () => {
    expect(sesionPorCookie("__client_uat=1760000000")).toBe(true);
    expect(sesionPorCookie("x=1; __client_uat_AbC123=1760000000")).toBe(true);
  });

  it("no confunde otra cookie con el mismo final", () => {
    expect(sesionPorCookie("mi__client_uat=1760000000")).toBe(false);
  });
});

describe("aplicarEstadoPrecio", () => {
  it("sin estado devuelve el mismo objeto", () => {
    expect(aplicarEstadoPrecio(producto, undefined)).toBe(producto);
  });

  it("precio privado: reemplaza el precio aunque sea MAYOR, sin tachar y sin medios ni cuotas", () => {
    const p = aplicarEstadoPrecio(producto, { tipo: "privado", precio: { price: 1500, precioFinal: 1815 } });
    expect(p).toMatchObject({ price: 1500, precioFinal: 1815, precioCuenta: "privado" });
    expect(p.oldPrice).toBeUndefined();
    expect(p.discount).toBeUndefined();
    expect(p.precioMedio).toBeUndefined();
    expect(p.preciosMedios).toBeUndefined();
    expect(p.cuotasSinInteres).toBeUndefined();
  });

  it("Consulte: precio 0 (la ficha bloquea el agregado) y nada del público", () => {
    const p = aplicarEstadoPrecio(producto, { tipo: "consulte" });
    expect(p).toMatchObject({ price: 0, precioCuenta: "consulte" });
    expect(p.precioFinal).toBeUndefined();
    expect(p.precioMedio).toBeUndefined();
  });

  it("pendiente: marca el estado y oculta medios y cuotas (no se muestra un precio que cambia)", () => {
    const p = aplicarEstadoPrecio(producto, { tipo: "pendiente" });
    expect(p.precioCuenta).toBe("pendiente");
    expect(p.cuotasSinInteres).toBeUndefined();
    expect(p.precioMedio).toBeUndefined();
  });
});
