import { describe, expect, it } from "vitest";
import {
  leerOpcionesCobro,
  opcionDelCobro,
  opcionHabilitada,
  opcionesAplicables,
} from "./opciones-cobro";

describe("leerOpcionesCobro", () => {
  it("filtra a las conocidas en orden canónico; lo que no es array es sin dato", () => {
    expect(leerOpcionesCobro(["cuenta_mp", "efectivo", "credito"])).toEqual(["credito", "cuenta_mp"]);
    expect(leerOpcionesCobro([])).toEqual([]);
    expect(leerOpcionesCobro(null)).toBeNull();
    expect(leerOpcionesCobro("credito")).toBeNull();
  });
});

describe("opcionesAplicables", () => {
  it("sin dato rigen las del procesador; vacío es ninguna, nunca todas", () => {
    expect(opcionesAplicables("mercadopago", undefined)).toEqual(["credito", "debito", "cuenta_mp"]);
    expect(opcionesAplicables("payway", undefined)).toEqual(["credito", "debito"]);
    expect(opcionesAplicables("mercadopago", [])).toEqual([]);
  });

  it("Payway ignora la cuenta de Mercado Pago", () => {
    expect(opcionesAplicables("payway", ["cuenta_mp", "debito"])).toEqual(["debito"]);
  });
});

describe("opcionDelCobro", () => {
  const mp = (metodoPagoId?: string, medio: "tarjeta" | "cuenta_mp" = "tarjeta") =>
    opcionDelCobro({ procesadorId: "mercadopago", medio, metodoPagoId });

  it("Mercado Pago: cuenta, débito por prefijo deb o maestro, el resto crédito", () => {
    expect(mp(undefined, "cuenta_mp")).toBe("cuenta_mp");
    expect(mp("debvisa")).toBe("debito");
    expect(mp("debmaster")).toBe("debito");
    expect(mp("debcabal")).toBe("debito");
    expect(mp("maestro")).toBe("debito");
    expect(mp("visa")).toBe("credito");
    expect(mp("naranja")).toBe("credito");
  });

  it("un id desconocido o ausente cuenta como crédito", () => {
    expect(mp("una-marca-nueva")).toBe("credito");
    expect(mp(undefined)).toBe("credito");
  });

  it("Payway: débito por la tabla de ids; crédito y lo desconocido, crédito", () => {
    const pw = (id?: string) => opcionDelCobro({ procesadorId: "payway", medio: "tarjeta", metodoPagoId: id });
    expect(pw("31")).toBe("debito"); // Visa débito
    expect(pw("1")).toBe("credito"); // Visa crédito
    expect(pw("abc")).toBe("credito");
    expect(pw(undefined)).toBe("credito");
  });
});

describe("opcionHabilitada", () => {
  it("vacío no habilita nada; sin dato habilita las del procesador", () => {
    expect(opcionHabilitada("mercadopago", [], "credito")).toBe(false);
    expect(opcionHabilitada("mercadopago", undefined, "cuenta_mp")).toBe(true);
    expect(opcionHabilitada("mercadopago", ["debito"], "credito")).toBe(false);
    expect(opcionHabilitada("payway", ["cuenta_mp"], "cuenta_mp")).toBe(false);
  });
});
