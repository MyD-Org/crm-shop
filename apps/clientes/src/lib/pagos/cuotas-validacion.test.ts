import { describe, expect, it } from "vitest";
import type { OfertaCuotas } from "./cuotas-tipos";
import { planParaPedido, validarCuotasPago, type EntradaValidacionCuotas } from "./cuotas-validacion";

const base: EntradaValidacionCuotas = {
  cuotas: 1,
  metodoPagoId: "visa",
  medio: "tarjeta",
  cuotasMax: 6,
  maxPorMedio: { visa: 6 },
  habilitado: true,
};
const validar = (p: Partial<EntradaValidacionCuotas>) => validarCuotasPago({ ...base, ...p });
const rechazo = { ok: false, motivo: "cuotas_no_disponibles" };

describe("validarCuotasPago — con flag y plan congelado", () => {
  it("cuotasMax 3 y llegan 12 → rechazo", () => {
    expect(validar({ cuotas: 12, cuotasMax: 3, maxPorMedio: { visa: 3 } })).toEqual(rechazo);
  });

  it("6 con máximo 6 → ok", () => {
    expect(validar({ cuotas: 6 })).toEqual({ ok: true, cuotas: 6 });
  });

  it("intermedia (5 con máximo 6) → ok", () => {
    expect(validar({ cuotas: 5 })).toEqual({ ok: true, cuotas: 5 });
  });

  it("1 cuota siempre ok, aunque el medio tenga tope 1", () => {
    expect(validar({ cuotas: 1, cuotasMax: 1, maxPorMedio: { visa: 1 } })).toEqual({ ok: true, cuotas: 1 });
  });

  it.each([0, -3, "abc", 2.5, Number.NaN, "6", null, {}])("cuotas %s → rechazo", (cuotas) => {
    expect(validar({ cuotas })).toEqual(rechazo);
  });

  it("sin cuotas en el body → 1", () => {
    expect(validar({ cuotas: undefined })).toEqual({ ok: true, cuotas: 1 });
  });

  it("límite por medio: master 12 con {visa:12, master:6} → rechazo; visa 12 → ok", () => {
    const plan = { cuotasMax: 12, maxPorMedio: { visa: 12, master: 6 } };
    expect(validar({ ...plan, cuotas: 12, metodoPagoId: "master" })).toEqual(rechazo);
    expect(validar({ ...plan, cuotas: 12, metodoPagoId: "visa" })).toEqual({ ok: true, cuotas: 12 });
  });

  it("medio fuera del snapshot (amex) → sólo tope global", () => {
    expect(validar({ cuotas: 6, metodoPagoId: "amex" })).toEqual({ ok: true, cuotas: 6 });
    expect(validar({ cuotas: 7, metodoPagoId: "amex" })).toEqual(rechazo);
  });

  it("sin metodoPagoId y con topes por medio → rechazo (no se puede saltear el tope)", () => {
    expect(validar({ cuotas: 6, metodoPagoId: undefined, maxPorMedio: { visa: 3 } })).toEqual(rechazo);
    expect(validar({ cuotas: 1, metodoPagoId: undefined, maxPorMedio: { visa: 3 } })).toEqual({ ok: true, cuotas: 1 });
  });

  it("sin metodoPagoId ni topes por medio → sólo tope global", () => {
    expect(validar({ cuotas: 6, metodoPagoId: undefined, maxPorMedio: null })).toEqual({ ok: true, cuotas: 6 });
  });
});

describe("validarCuotasPago — legacy (clamp 1..24 de siempre)", () => {
  it("cuotasMax null → clamp", () => {
    expect(validar({ cuotasMax: null, maxPorMedio: null, cuotas: 12 })).toEqual({ ok: true, cuotas: 12 });
    expect(validar({ cuotasMax: null, maxPorMedio: null, cuotas: 30 })).toEqual({ ok: true, cuotas: 1 });
    expect(validar({ cuotasMax: null, maxPorMedio: null, cuotas: 2.7 })).toEqual({ ok: true, cuotas: 2 });
    expect(validar({ cuotasMax: null, maxPorMedio: null, cuotas: "abc" })).toEqual({ ok: true, cuotas: 1 });
  });

  it("flag off con pedido cuotasMax 3 → 12 se acepta", () => {
    expect(validar({ habilitado: false, cuotasMax: 3, cuotas: 12 })).toEqual({ ok: true, cuotas: 12 });
  });

  it("medio cuenta_mp → sin validación de cuotas", () => {
    expect(validar({ medio: "cuenta_mp", cuotasMax: 1, cuotas: 12 })).toEqual({ ok: true, cuotas: 12 });
  });
});

const oferta = (opciones: { codigo: string; cuotas: number; montoMinimo?: number }[]): OfertaCuotas => {
  const codigos = [...new Set(["visa", "master", ...opciones.map((o) => o.codigo)])];
  return {
    hoy: "2026-09-16",
    planesFetchedAt: "2026-09-16T10:00:00.000Z",
    configVersion: "2026-09-16T09:00:00.000Z",
    medios: codigos.map((codigo, orden) => ({
      codigo,
      nombre: codigo,
      orden,
      opciones: opciones
        .filter((o) => o.codigo === codigo)
        .map((o) => ({
          cuotas: o.cuotas, sinInteres: true, montoMinimo: o.montoMinimo ?? 0, tasaPct: 0,
          cftPct: 0, teaPct: 0, montoMin: null, montoMax: null,
        })),
    })),
  };
};

describe("planParaPedido", () => {
  it("medio distinto de mercadopago → null", () => {
    expect(planParaPedido("transferencia", 200000, oferta([{ codigo: "visa", cuotas: 6 }]))).toBeNull();
  });

  it("oferta ilegible (null) → null: cuotas_max null, legacy", () => {
    expect(planParaPedido("mercadopago", 200000, null)).toBeNull();
  });

  it("oferta sin opciones para el total → cuotasMax 1 y cada medio de la oferta con tope 1", () => {
    const p = planParaPedido("mercadopago", 100000, oferta([{ codigo: "visa", cuotas: 6, montoMinimo: 150000 }]));
    expect(p).toMatchObject({ cuotasMax: 1, maxPorMedio: { visa: 1, master: 1 } });
  });

  it("pedido 200.000 con 6 SI desde 150.000 en visa → cuotasMax 6, master (sin opciones) tope 1", () => {
    const p = planParaPedido("mercadopago", 200000, oferta([{ codigo: "visa", cuotas: 6, montoMinimo: 150000 }]));
    expect(p).toMatchObject({ cuotasMax: 6, maxPorMedio: { visa: 6, master: 1 }, totalBase: 200000 });
  });

  it("total 145.000 → no incluye 6 desde 150.000", () => {
    const p = planParaPedido("mercadopago", 145000, oferta([{ codigo: "visa", cuotas: 6, montoMinimo: 150000 }, { codigo: "visa", cuotas: 3 }]));
    expect(p).toMatchObject({ cuotasMax: 3 });
  });
});
