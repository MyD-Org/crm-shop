import { describe, expect, it } from "vitest";
import {
  NOTA_PAGO_A_CONFIRMAR,
  instruccionesDelPago,
  medioElegido,
  mediosParaModalidad,
  nombreDelPago,
  pagoValidoConMedios,
  type MedioPago,
} from "./medios-pago";

const medio = (o: Partial<MedioPago> & { slug: string }): MedioPago => ({
  nombre: o.slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 0,
  ...o,
});

const MEDIOS: MedioPago[] = [
  medio({ slug: "transferencia", nombre: "Transferencia bancaria", orden: 2, instrucciones: "CBU 000 (ficticio)" }),
  medio({ slug: "efectivo", nombre: "Efectivo en el local", orden: 1, aplicaEnvio: false }),
  medio({ slug: "cheque", nombre: "Cheque", orden: 3, aplicaRetiro: false }),
  medio({ slug: "viejo", nombre: "Medio viejo", activo: false }),
  medio({ slug: "tarjeta", nombre: "Tarjeta", cobroOnline: true, orden: 4 }),
  medio({ slug: "mercadopago", nombre: "MP colado", orden: 0 }),
];

describe("mediosParaModalidad", () => {
  it("retiro: activos que aplican a retiro, en el orden del operador", () => {
    expect(mediosParaModalidad(MEDIOS, "retiro").map((m) => m.slug)).toEqual([
      "efectivo",
      "transferencia",
      "tarjeta",
    ]);
  });

  it("envío: no ofrece el que aplica sólo a retiro (ni el inactivo)", () => {
    expect(mediosParaModalidad(MEDIOS, "envio").map((m) => m.slug)).toEqual([
      "transferencia",
      "cheque",
      "tarjeta",
    ]);
  });

  it("no ofrece slugs reservados aunque estén cargados y activos", () => {
    for (const e of ["retiro", "envio"] as const) {
      expect(mediosParaModalidad(MEDIOS, e).map((m) => m.slug)).not.toContain("mercadopago");
    }
  });

  it("cobro online se trata como manual: se ofrece igual que cualquier otro", () => {
    expect(mediosParaModalidad(MEDIOS, "retiro").find((m) => m.slug === "tarjeta")).toBeDefined();
  });

  it("empate de orden: por nombre", () => {
    const r = mediosParaModalidad([medio({ slug: "b", nombre: "Beta" }), medio({ slug: "a", nombre: "Alfa" })], "retiro");
    expect(r.map((m) => m.slug)).toEqual(["a", "b"]);
  });
});

describe("medioElegido", () => {
  it("devuelve el elegido si sigue aplicando", () => {
    expect(medioElegido(MEDIOS, "retiro", "transferencia")?.slug).toBe("transferencia");
  });
  it("si dejó de aplicar (pasó a envío), el primero de la lista", () => {
    expect(medioElegido(MEDIOS, "envio", "efectivo")?.slug).toBe("transferencia");
  });
  it("sin medios aplicables, null", () => {
    expect(medioElegido([], "retiro", "x")).toBeNull();
  });
});

describe("pagoValidoConMedios", () => {
  it("acepta un medio aplicable a la modalidad", () => {
    expect(pagoValidoConMedios(MEDIOS, "retiro", "efectivo")).toBe(true);
  });
  it("rechaza uno inactivo, uno que no aplica y uno inventado", () => {
    expect(pagoValidoConMedios(MEDIOS, "retiro", "viejo")).toBe(false);
    expect(pagoValidoConMedios(MEDIOS, "envio", "efectivo")).toBe(false);
    expect(pagoValidoConMedios(MEDIOS, "retiro", "xyz")).toBe(false);
  });
  it("rechaza mercadopago y a_coordinar cuando hay medios aplicables", () => {
    expect(pagoValidoConMedios(MEDIOS, "retiro", "mercadopago")).toBe(false);
    expect(pagoValidoConMedios(MEDIOS, "retiro", "a_coordinar")).toBe(false);
  });
  it("si ninguno aplica a la modalidad, sólo vale a_coordinar", () => {
    const soloRetiro = [medio({ slug: "efectivo", aplicaEnvio: false })];
    expect(pagoValidoConMedios(soloRetiro, "envio", "a_coordinar")).toBe(true);
    expect(pagoValidoConMedios(soloRetiro, "envio", "efectivo")).toBe(false);
  });
});

describe("nombreDelPago / instruccionesDelPago", () => {
  it("resuelve el slug al nombre del medio, aunque esté inactivo", () => {
    expect(nombreDelPago("transferencia", MEDIOS)).toBe("Transferencia bancaria");
    expect(nombreDelPago("viejo", MEDIOS)).toBe("Medio viejo");
  });
  it("si no matchea: la etiqueta de los métodos fijos y, si no, el texto crudo", () => {
    expect(nombreDelPago("mercadopago", [])).toBe("Tarjeta o Mercado Pago");
    expect(nombreDelPago("cuenta_corriente", null)).toBe("Cuenta corriente");
    expect(nombreDelPago("algo-raro", MEDIOS)).toBe("algo-raro");
  });
  it("instrucciones: las del medio o null", () => {
    expect(instruccionesDelPago("transferencia", MEDIOS)).toBe("CBU 000 (ficticio)");
    expect(instruccionesDelPago("efectivo", MEDIOS)).toBeNull();
    expect(instruccionesDelPago("nada", MEDIOS)).toBeNull();
  });
});

describe("la nota del paso Pago", () => {
  it("dice que no se cobra en este paso", () => {
    expect(NOTA_PAGO_A_CONFIRMAR).toBe(
      "El pago se coordina después de confirmar el pedido; no se cobra en este paso.",
    );
  });
});
