import { describe, expect, it } from "vitest";
import { MARCAS_TARJETA } from "./marcas";
import { tarjetasDeMercadoPago } from "./tarjetas-aceptadas";
import {
  TARJETAS_PAYWAY,
  marcaAceptadaPorPayway,
  marcasDePayway,
  textoMarcasPayway,
  tarjetasPayway,
} from "./tarjetas-payway";

const medio = (id: string, name: string, payment_type_id: string) => ({
  id,
  name,
  payment_type_id,
  status: "active",
  secure_thumbnail: `https://img.example/${id}.gif`,
});

const respuestaMp = [
  medio("visa", "Visa", "credit_card"),
  medio("master", "Mastercard", "credit_card"),
  medio("amex", "American Express", "credit_card"),
  medio("naranja", "Naranja", "credit_card"),
  medio("cabal", "Cabal", "credit_card"),
  medio("diners", "Diners", "credit_card"),
  medio("debvisa", "Visa Débito", "debit_card"),
  medio("debmaster", "Mastercard Débito", "debit_card"),
  medio("maestro", "Maestro", "debit_card"),
  medio("debcabal", "Cabal Débito", "debit_card"),
];

describe("TARJETAS_PAYWAY (convenio de Central Led)", () => {
  it("crédito: Visa, Mastercard, American Express y Cabal; débito: Visa, Mastercard y Cabal", () => {
    expect(TARJETAS_PAYWAY.credito).toEqual(["visa", "mastercard", "amex", "cabal"]);
    expect(TARJETAS_PAYWAY.debito).toEqual(["visa", "mastercard", "cabal"]);
  });

  it("usa sólo ids canónicos de marcas.ts", () => {
    const canonicos = MARCAS_TARJETA.map((m) => m.id) as string[];
    for (const id of [...TARJETAS_PAYWAY.credito, ...TARJETAS_PAYWAY.debito]) expect(canonicos).toContain(id);
  });

  it("marcasDePayway y marcaAceptadaPorPayway dejan afuera Naranja, Diners y Maestro", () => {
    expect(marcasDePayway("credito")).toEqual(["visa", "mastercard", "amex", "cabal"]);
    expect(marcasDePayway("debito")).toEqual(["visa", "mastercard", "cabal"]);
    for (const id of ["visa", "mastercard", "amex", "cabal"]) expect(marcaAceptadaPorPayway(id)).toBe(true);
    for (const id of ["naranja", "diners", "maestro", "argencard", "otra", null]) expect(marcaAceptadaPorPayway(id)).toBe(false);
  });
});

describe("textoMarcasPayway", () => {
  it("lista las marcas en castellano, sin Naranja ni Diners", () => {
    expect(textoMarcasPayway("credito")).toBe("Visa, Mastercard, American Express y Cabal");
    expect(textoMarcasPayway("debito")).toBe("Visa, Mastercard y Cabal");
    for (const t of [textoMarcasPayway("credito"), textoMarcasPayway("debito")]) expect(t).not.toMatch(/Naranja|Diners/);
  });
});

describe("tarjetasPayway", () => {
  it("toma de Mercado Pago el logo de cada marca del convenio, en el orden del convenio", () => {
    const t = tarjetasPayway(tarjetasDeMercadoPago(respuestaMp));
    expect(t.credito.map((x) => x.logo)).toEqual([
      "https://img.example/visa.gif",
      "https://img.example/master.gif",
      "https://img.example/amex.gif",
      "https://img.example/cabal.gif",
    ]);
    expect(t.debito.map((x) => x.logo)).toEqual([
      "https://img.example/debvisa.gif",
      "https://img.example/debmaster.gif",
      "https://img.example/debcabal.gif",
    ]);
  });

  it("no muestra Naranja, Diners ni Maestro aunque Mercado Pago los devuelva", () => {
    const t = tarjetasPayway(tarjetasDeMercadoPago(respuestaMp));
    const nombres = [...t.credito, ...t.debito].map((x) => x.nombre).join(" ");
    expect(nombres).not.toMatch(/Naranja|Diners|Maestro/);
  });

  it("si Mercado Pago no devolvió una marca, ese logo no aparece", () => {
    const t = tarjetasPayway(tarjetasDeMercadoPago(respuestaMp.filter((m) => m.id !== "amex" && m.id !== "debcabal")));
    expect(t.credito.map((x) => x.nombre)).toEqual(["Visa", "Mastercard", "Cabal"]);
    expect(t.debito.map((x) => x.nombre)).toEqual(["Visa Débito", "Mastercard Débito"]);
  });

  it("sin tarjetas de Mercado Pago (o sin datos) los logos son los propios", () => {
    for (const t of [tarjetasPayway(tarjetasDeMercadoPago([])), tarjetasPayway(undefined)]) {
      expect(t.credito.map((x) => x.nombre)).toEqual(["Visa", "Mastercard", "American Express", "Cabal"]);
      expect(t.debito.map((x) => x.nombre)).toEqual(["Visa Débito", "Mastercard Débito", "Cabal Débito"]);
    }
  });
});
