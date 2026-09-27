import { describe, expect, it } from "vitest";
import { precioCuenta } from "./precio-cuenta";

const precios = [
  { idPriceList: "1", price: 1000, main: true },
  { idPriceList: "2", price: 800 },
  { idPriceList: "3", price: 1200 },
];

describe("precioCuenta", () => {
  it("lista propia más barata ⇒ su precio, con IVA", () => {
    expect(precioCuenta(precios, 21, "2")).toEqual({ price: 800, precioFinal: 968 });
  });

  it("sin IVA conocido ⇒ sólo el neto", () => {
    expect(precioCuenta(precios, null, "2")).toEqual({ price: 800 });
  });

  it("lista más cara, igual a la general o inexistente ⇒ null (no se tacha)", () => {
    expect(precioCuenta(precios, 21, "3")).toBeNull();
    expect(precioCuenta(precios, 21, "1")).toBeNull();
    expect(precioCuenta(precios, 21, "9")).toBeNull();
  });

  it("sin lista o con precio 0 ⇒ null", () => {
    expect(precioCuenta(precios, 21, undefined)).toBeNull();
    expect(precioCuenta([{ idPriceList: "1", price: 1000, main: true }, { idPriceList: "2", price: 0 }], 21, "2")).toBeNull();
  });
});
