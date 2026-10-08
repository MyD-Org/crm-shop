import { describe, expect, it } from "vitest";
import {
  leerMarcas,
  marcaDeMercadoPago,
  marcaDePayway,
  marcaPermitida,
  MARCAS_TARJETA,
  nombreDeMarca,
} from "./marcas";

describe("marcaDeMercadoPago", () => {
  it.each([
    ["visa", "visa"],
    ["debvisa", "visa"],
    ["master", "mastercard"],
    ["debmaster", "mastercard"],
    ["maestro", "maestro"],
    ["amex", "amex"],
    ["naranja", "naranja"],
    ["cabal", "cabal"],
    ["debcabal", "cabal"],
    ["argencard", "argencard"],
    ["diners", "diners"],
  ])("%s => %s", (id, canon) => {
    expect(marcaDeMercadoPago(id)).toBe(canon);
  });

  it("lo desconocido o sin verificar es null, sin lanzar", () => {
    for (const id of ["cencosud", "tarshop", "account_money", "", "VISA", null, undefined, 1]) {
      expect(marcaDeMercadoPago(id as unknown as string)).toBeNull();
    }
  });
});

describe("marcaDePayway", () => {
  it.each([
    [1, "visa"],
    [31, "visa"],
    [104, "mastercard"],
    [105, "mastercard"],
    [106, "maestro"],
    [65, "amex"],
    [63, "cabal"],
    [108, "cabal"],
    [24, "naranja"],
    [8, "diners"],
    [30, "argencard"],
  ])("%i => %s", (id, canon) => {
    expect(marcaDePayway(id)).toBe(canon);
    expect(marcaDePayway(String(id))).toBe(canon);
  });

  it("las tarjetas de retail y los ids desconocidos son null", () => {
    for (const id of [109, 43, 23, 999, 0, "x", null, undefined]) {
      expect(marcaDePayway(id as unknown as number)).toBeNull();
    }
  });
});

describe("nombreDeMarca", () => {
  it("da el nombre visible de cada marca conocida", () => {
    expect(nombreDeMarca("mastercard")).toBe("Mastercard");
    expect(nombreDeMarca("amex")).toBe("American Express");
    for (const m of MARCAS_TARJETA) expect(nombreDeMarca(m.id)).toBe(m.nombre);
  });

  it("cae al id con algo desconocido", () => {
    expect(nombreDeMarca("otra")).toBe("otra");
  });
});

describe("marcaPermitida", () => {
  it("sin restricción (null) vale cualquier tarjeta, incluso desconocida", () => {
    expect(marcaPermitida(null, "visa")).toBe(true);
    expect(marcaPermitida(undefined, null)).toBe(true);
  });

  it("con restricción sólo las incluidas; marca desconocida nunca", () => {
    expect(marcaPermitida(["visa"], "visa")).toBe(true);
    expect(marcaPermitida(["visa"], "mastercard")).toBe(false);
    expect(marcaPermitida(["visa"], null)).toBe(false);
    expect(marcaPermitida([], "visa")).toBe(false);
  });
});

describe("leerMarcas", () => {
  it("null o lo que no es arreglo = todas", () => {
    expect(leerMarcas(null)).toEqual({ marcas: null, inaccesible: false });
    expect(leerMarcas(undefined)).toEqual({ marcas: null, inaccesible: false });
    expect(leerMarcas("visa")).toEqual({ marcas: null, inaccesible: false });
  });

  it("filtra a las conocidas; si no queda ninguna, la condición es inaccesible", () => {
    expect(leerMarcas(["visa", "nativa", "mastercard"])).toEqual({ marcas: ["visa", "mastercard"], inaccesible: false });
    expect(leerMarcas(["nativa"])).toEqual({ marcas: [], inaccesible: true });
    expect(leerMarcas([])).toEqual({ marcas: [], inaccesible: true });
  });
});
