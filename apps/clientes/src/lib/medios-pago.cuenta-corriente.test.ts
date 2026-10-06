import { describe, expect, it } from "vitest";
import {
  esCompradorCuentaCorriente,
  mediosParaModalidad,
  mediosVisiblesPara,
  medioElegido,
  pagoValidoConMedios,
  pieDelMedio,
  textoPagaConMedio,
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
  idListaPrecios: null,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...o,
});

const CC = medio({ slug: "efectivo-cheque", nombre: "Efectivo o cheque", audiencia: "cuenta_corriente" });
const MEDIOS = [
  medio({ slug: "transferencia", nombre: "Transferencia bancaria", orden: 1 }),
  medio({ slug: "mercadopago", nombre: "Mercado Pago", cobroOnline: true, orden: 2 }),
  CC,
];

describe("esCompradorCuentaCorriente", () => {
  it("sólo quien tiene tipoCuenta corriente", () => {
    expect(esCompradorCuentaCorriente({ tipoCuenta: "corriente" })).toBe(true);
    expect(esCompradorCuentaCorriente({ tipoCuenta: "contado" })).toBe(false);
    expect(esCompradorCuentaCorriente({})).toBe(false);
    expect(esCompradorCuentaCorriente(null)).toBe(false);
    expect(esCompradorCuentaCorriente(undefined)).toBe(false);
  });
});

describe("medios para un comprador con cuenta corriente", () => {
  const opts = { esCuentaCorriente: true };

  it("el único medio ofrecido es el de audiencia cuenta_corriente, sin cobro en línea", () => {
    for (const entrega of ["retiro", "envio"] as const) {
      expect(mediosParaModalidad(MEDIOS, entrega, opts).map((m) => m.slug)).toEqual(["efectivo-cheque"]);
    }
  });

  it("el servidor acepta sólo ese medio: cualquier otro (cobro en línea incluido) se rechaza", () => {
    expect(pagoValidoConMedios(MEDIOS, "retiro", "efectivo-cheque", opts)).toBe(true);
    expect(pagoValidoConMedios(MEDIOS, "retiro", "transferencia", opts)).toBe(false);
    expect(pagoValidoConMedios(MEDIOS, "retiro", "mercadopago", opts)).toBe(false);
    expect(pagoValidoConMedios(MEDIOS, "retiro", "a_coordinar", opts)).toBe(false);
  });

  it("con el medio inactivo queda a_coordinar (y nada más)", () => {
    const inactivo = [...MEDIOS.slice(0, 2), { ...CC, activo: false }];
    expect(mediosParaModalidad(inactivo, "retiro", opts)).toEqual([]);
    expect(pagoValidoConMedios(inactivo, "retiro", "a_coordinar", opts)).toBe(true);
    expect(pagoValidoConMedios(inactivo, "retiro", "transferencia", opts)).toBe(false);
  });

  it("sin medio de cuenta corriente cargado queda a_coordinar", () => {
    expect(pagoValidoConMedios(MEDIOS.slice(0, 2), "retiro", "a_coordinar", opts)).toBe(true);
  });

  it("medioElegido devuelve el de cuenta corriente aunque se pida otro slug", () => {
    expect(medioElegido(MEDIOS, "retiro", "mercadopago", opts)?.slug).toBe("efectivo-cheque");
  });
});

describe("el público no cambia", () => {
  it("no ve ni puede pagar con el medio de cuenta corriente", () => {
    expect(mediosParaModalidad(MEDIOS, "retiro").map((m) => m.slug)).toEqual(["transferencia", "mercadopago"]);
    expect(pagoValidoConMedios(MEDIOS, "retiro", "efectivo-cheque")).toBe(false);
    expect(pagoValidoConMedios(MEDIOS, "retiro", "efectivo-cheque", { esCuentaCorriente: false })).toBe(false);
  });
});

describe("mediosVisiblesPara (lo que viaja al navegador)", () => {
  it("el público no recibe el medio de cuenta corriente: ni su nombre ni sus instrucciones", () => {
    const r = mediosVisiblesPara([{ ...CC, instrucciones: "Texto interno" }, MEDIOS[0]], false);
    expect(r.map((m) => m.slug)).toEqual(["transferencia"]);
  });

  it("la cuenta corriente recibe sólo el suyo", () => {
    expect(mediosVisiblesPara(MEDIOS, true).map((m) => m.slug)).toEqual(["efectivo-cheque"]);
  });
});

describe("textos en usted", () => {
  it("informa con qué medio paga, tomando el nombre del medio", () => {
    expect(textoPagaConMedio("Efectivo o cheque")).toBe("Pagará con Efectivo o cheque.");
    expect(pieDelMedio(CC)).toBe("Pagará con Efectivo o cheque. No se le cobra nada ahora.");
  });

  it("no usa voseo ni tuteo", () => {
    const t = `${textoPagaConMedio("X")} ${pieDelMedio(CC)}`;
    expect(t).not.toMatch(/\b(tu|tus|te|vos|pagás|pagarás)\b/i);
  });
});
