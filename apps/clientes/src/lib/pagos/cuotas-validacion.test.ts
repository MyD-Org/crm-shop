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

describe("revisionDeCuotas con la intención del intento (migración 0034)", () => {
  const conInteres = (cuotas: number, totalEsperado: number) => ({ cuotas, totalEsperado, conInteres: true });
  const sinInteres = (cuotas: number, totalEsperado: number) => ({ cuotas, totalEsperado, conInteres: false });

  it("con interés elegido: mismas cuotas y total mayor (el interés) → sin marca", () => {
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 6, totalPagado: 66070 }, conInteres(6, 50000)),
    ).toBeNull();
  });

  it("con interés: el pedido en 1 pago o sin cuotas congeladas (null) igual se revisa", () => {
    expect(
      revisionDeCuotas({ cuotas: null, total: 50000 }, { cuotas: 3, totalPagado: 59845 }, conInteres(6, 50000)),
    ).toBe("cuotas_distintas");
    expect(
      revisionDeCuotas({ cuotas: null, total: 50000 }, { cuotas: 6, totalPagado: 66070 }, conInteres(6, 50000)),
    ).toBeNull();
  });

  it("con interés: cuotas pagadas distintas de las pedidas → cuotas_distintas", () => {
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 3, totalPagado: 66070 }, conInteres(6, 50000)),
    ).toBe("cuotas_distintas");
  });

  it("con interés: total pagado MENOR al esperado → monto_distinto", () => {
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 6, totalPagado: 40000 }, conInteres(6, 50000)),
    ).toBe("monto_distinto");
  });

  it("con interés: tolera el redondeo de las cuotas (un centavo por cuota)", () => {
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 6, totalPagado: 49999.95 }, conInteres(6, 50000)),
    ).toBeNull();
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 6, totalPagado: 49999.93 }, conInteres(6, 50000)),
    ).toBe("monto_distinto");
    // Con una sola cuota la tolerancia sigue siendo un centavo.
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 1, totalPagado: 49999.98 }, conInteres(1, 50000)),
    ).toBe("monto_distinto");
  });

  it("sin interés con intención: contra lo pedido, igual que antes (total distinto → monto_distinto)", () => {
    expect(
      revisionDeCuotas({ cuotas: 3, total: 52000 }, { cuotas: 3, totalPagado: 60000 }, sinInteres(3, 52000)),
    ).toBe("monto_distinto");
    expect(
      revisionDeCuotas({ cuotas: 3, total: 52000 }, { cuotas: 3, totalPagado: 52000 }, sinInteres(3, 52000)),
    ).toBeNull();
    expect(
      revisionDeCuotas({ cuotas: 3, total: 52000 }, { cuotas: 6, totalPagado: 52000 }, sinInteres(3, 52000)),
    ).toBe("cuotas_distintas");
  });

  it("1 pago con intención y pedido sin cuotas congeladas: SÍ se revisa", () => {
    expect(
      revisionDeCuotas({ cuotas: null, total: 50000 }, { cuotas: 6, totalPagado: 66070 }, sinInteres(1, 50000)),
    ).toBe("cuotas_distintas");
  });

  it("sin intención (intento anterior o recuperado por el webhook): reglas de antes", () => {
    expect(revisionDeCuotas({ cuotas: 6, total: 1200 }, { cuotas: 6, totalPagado: 1290 }, null)).toBe("monto_distinto");
    expect(revisionDeCuotas({ cuotas: null, total: 1200 }, { cuotas: 12, totalPagado: 2000 }, null)).toBeNull();
  });

  it("datos que el procesador no informó no se acusan", () => {
    expect(revisionDeCuotas({ cuotas: 1, total: 50000 }, {}, conInteres(6, 50000))).toBeNull();
  });
});
