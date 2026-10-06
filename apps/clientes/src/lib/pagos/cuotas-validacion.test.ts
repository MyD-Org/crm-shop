import { describe, expect, it } from "vitest";
import { revisionDeCuotas, validarCuotasPago, type EntradaValidacionCuotas } from "./cuotas-validacion";

const base: EntradaValidacionCuotas = { cuotas: 6, medio: "tarjeta", cuotasPedido: 6 };
const validar = (p: Partial<EntradaValidacionCuotas>) => validarCuotasPago({ ...base, ...p });
const rechazo = { ok: false, motivo: "cuotas_distintas" };

describe("validarCuotasPago: pedido con cuotas congeladas = IGUALDAD estricta", () => {
  it("las mismas cuotas pasan", () => {
    expect(validar({})).toEqual({ ok: true, cuotas: 6 });
    expect(validar({ cuotas: 3, cuotasPedido: 3 })).toEqual({ ok: true, cuotas: 3 });
  });

  it("MENOS cuotas que las congeladas se rechaza (el comprador bajó la cantidad en el formulario)", () => {
    expect(validar({ cuotas: 3 })).toEqual(rechazo);
    expect(validar({ cuotas: 1 })).toEqual(rechazo);
  });

  it("MÁS cuotas que las congeladas se rechaza", () => {
    expect(validar({ cuotas: 12, cuotasPedido: 6 })).toEqual(rechazo);
    expect(validar({ cuotas: 6, cuotasPedido: 3 })).toEqual(rechazo);
  });

  it("un pedido congelado en un pago (1) sólo acepta 1 (o ausente)", () => {
    expect(validar({ cuotas: 1, cuotasPedido: 1 })).toEqual({ ok: true, cuotas: 1 });
    expect(validar({ cuotas: undefined, cuotasPedido: 1 })).toEqual({ ok: true, cuotas: 1 });
    expect(validar({ cuotas: 2, cuotasPedido: 1 })).toEqual(rechazo);
  });

  it("sin cuotas en el body con un pedido en N >= 2: rechazo (no se asume)", () => {
    expect(validar({ cuotas: undefined })).toEqual(rechazo);
  });

  it.each([0, -3, "abc", 2.5, Number.NaN, "6", null, {}])("cuotas %s con pedido en 6 → rechazo", (cuotas) => {
    expect(validar({ cuotas })).toEqual(rechazo);
  });

  it("aplica con cualquier medio del procesador (no depende del proveedor)", () => {
    expect(validar({ medio: "cuenta_mp", cuotas: 3 })).toEqual(rechazo);
  });
});

describe("validarCuotasPago: pedido sin cuotas congeladas (flag apagado o anterior) = clamp de siempre", () => {
  const legacy = { cuotasPedido: null };
  it("clamp 1..24", () => {
    expect(validar({ ...legacy, cuotas: 12 })).toEqual({ ok: true, cuotas: 12 });
    expect(validar({ ...legacy, cuotas: 30 })).toEqual({ ok: true, cuotas: 1 });
    expect(validar({ ...legacy, cuotas: 2.7 })).toEqual({ ok: true, cuotas: 2 });
    expect(validar({ ...legacy, cuotas: "abc" })).toEqual({ ok: true, cuotas: 1 });
    expect(validar({ ...legacy, cuotas: undefined })).toEqual({ ok: true, cuotas: 1 });
  });
});

describe("revisionDeCuotas (reconciliación contra lo que informó el procesador)", () => {
  const pedido = { cuotas: 6, total: 1200 };

  it("coincide: sin revisión", () => {
    expect(revisionDeCuotas(pedido, { cuotas: 6, totalPagado: 1200 })).toBeNull();
  });

  it("cuotas distintas: cuotas_distintas", () => {
    expect(revisionDeCuotas(pedido, { cuotas: 12, totalPagado: 1200 })).toBe("cuotas_distintas");
  });

  it("monto distinto (el procesador cobró interés): monto_distinto", () => {
    expect(revisionDeCuotas(pedido, { cuotas: 6, totalPagado: 1290 })).toBe("monto_distinto");
  });

  it("tolera un centavo de diferencia", () => {
    expect(revisionDeCuotas(pedido, { cuotas: 6, totalPagado: 1200.01 })).toBeNull();
    expect(revisionDeCuotas(pedido, { cuotas: 6, totalPagado: 1200.02 })).toBe("monto_distinto");
  });

  it("si cuotas y monto difieren, manda la discrepancia de cuotas", () => {
    expect(revisionDeCuotas(pedido, { cuotas: 3, totalPagado: 1300 })).toBe("cuotas_distintas");
  });

  it("datos que el procesador no informó no se acusan", () => {
    expect(revisionDeCuotas(pedido, {})).toBeNull();
    expect(revisionDeCuotas(pedido, { cuotas: 6 })).toBeNull();
  });

  it("pedido sin cuotas congeladas (anterior o flag apagado): nunca se revisa", () => {
    expect(revisionDeCuotas({ cuotas: null, total: 1200 }, { cuotas: 12, totalPagado: 2000 })).toBeNull();
  });
});
