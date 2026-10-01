import { describe, expect, it } from "vitest";
import {
  NOTA_PAGO_A_CONFIRMAR,
  SLUGS_RESERVADOS,
  SLUG_MERCADOPAGO,
  esPagoEnLinea,
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
  medio({ slug: "mercadopago", nombre: "Mercado Pago", cobroOnline: true, orden: 0 }),
];

describe("mediosParaModalidad", () => {
  it("retiro: activos que aplican a retiro, en el orden del operador", () => {
    expect(mediosParaModalidad(MEDIOS, "retiro").map((m) => m.slug)).toEqual([
      "mercadopago",
      "efectivo",
      "transferencia",
      "tarjeta",
    ]);
  });

  it("envío: no ofrece el que aplica sólo a retiro (ni el inactivo)", () => {
    expect(mediosParaModalidad(MEDIOS, "envio").map((m) => m.slug)).toEqual([
      "mercadopago",
      "transferencia",
      "cheque",
      "tarjeta",
    ]);
  });

  it("mercadopago ya no es un slug reservado: se ofrece si está activo y aplica", () => {
    expect(SLUGS_RESERVADOS).toEqual(["a_coordinar"]);
    expect(SLUG_MERCADOPAGO).toBe("mercadopago");
    for (const e of ["retiro", "envio"] as const) {
      expect(mediosParaModalidad(MEDIOS, e).map((m) => m.slug)).toContain("mercadopago");
    }
  });

  it("sin credenciales (mpDisponible=false) se filtra mercadopago", () => {
    for (const e of ["retiro", "envio"] as const) {
      expect(
        mediosParaModalidad(MEDIOS, e, { mpDisponible: false }).map((m) => m.slug),
      ).not.toContain("mercadopago");
    }
  });

  it("a_coordinar nunca se ofrece como medio aunque esté cargado", () => {
    const r = mediosParaModalidad([medio({ slug: "a_coordinar" }), medio({ slug: "x" })], "retiro");
    expect(r.map((m) => m.slug)).toEqual(["x"]);
  });

  it("esPagoEnLinea sólo para mercadopago", () => {
    expect(esPagoEnLinea("mercadopago")).toBe(true);
    expect(esPagoEnLinea("transferencia")).toBe(false);
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
    expect(medioElegido(MEDIOS, "envio", "efectivo")?.slug).toBe("mercadopago");
    expect(medioElegido(MEDIOS, "envio", "efectivo", { mpDisponible: false })?.slug).toBe("transferencia");
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
  it("mercadopago es válido si está activo y hay credenciales; sin ellas, no", () => {
    expect(pagoValidoConMedios(MEDIOS, "retiro", "mercadopago")).toBe(true);
    expect(pagoValidoConMedios(MEDIOS, "retiro", "mercadopago", { mpDisponible: false })).toBe(false);
  });
  it("mercadopago inactivo o que no aplica a la modalidad se rechaza", () => {
    const inactivo = [medio({ slug: "mercadopago", activo: false }), medio({ slug: "efectivo" })];
    expect(pagoValidoConMedios(inactivo, "retiro", "mercadopago")).toBe(false);
    const soloRetiro = [medio({ slug: "mercadopago", aplicaEnvio: false }), medio({ slug: "efectivo" })];
    expect(pagoValidoConMedios(soloRetiro, "envio", "mercadopago")).toBe(false);
  });
  it("rechaza a_coordinar cuando hay medios aplicables", () => {
    expect(pagoValidoConMedios(MEDIOS, "retiro", "a_coordinar")).toBe(false);
  });
  it("si el único aplicable es MP y no hay credenciales, sólo vale a_coordinar", () => {
    const soloMp = [medio({ slug: "mercadopago" })];
    expect(pagoValidoConMedios(soloMp, "retiro", "a_coordinar", { mpDisponible: false })).toBe(true);
    expect(pagoValidoConMedios(soloMp, "retiro", "a_coordinar")).toBe(false);
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
