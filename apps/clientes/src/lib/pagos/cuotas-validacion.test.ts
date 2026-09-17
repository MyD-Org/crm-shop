import { describe, expect, it } from "vitest";
import type { OfertaCuotas } from "./cuotas-tipos";
import { planParaPedido, validarCuotasPago, type EntradaValidacionCuotas } from "./cuotas-validacion";

const base: EntradaValidacionCuotas = {
  cuotas: 1,
  medio: "tarjeta",
  cuotasMax: 6,
  habilitado: true,
};
const validar = (p: Partial<EntradaValidacionCuotas>) => validarCuotasPago({ ...base, ...p });
const rechazo = { ok: false, motivo: "cuotas_no_disponibles" };

describe("validarCuotasPago — con flag y plan congelado", () => {
  it("cuotasMax 3 y llegan 12 → rechazo", () => {
    expect(validar({ cuotas: 12, cuotasMax: 3 })).toEqual(rechazo);
  });

  it("6 con máximo 6 → ok", () => {
    expect(validar({ cuotas: 6 })).toEqual({ ok: true, cuotas: 6 });
  });

  it("intermedia (5 con máximo 6) → ok", () => {
    expect(validar({ cuotas: 5 })).toEqual({ ok: true, cuotas: 5 });
  });

  it("1 cuota siempre ok, aunque el máximo sea 1", () => {
    expect(validar({ cuotas: 1, cuotasMax: 1 })).toEqual({ ok: true, cuotas: 1 });
  });

  it.each([0, -3, "abc", 2.5, Number.NaN, "6", null, {}])("cuotas %s → rechazo", (cuotas) => {
    expect(validar({ cuotas })).toEqual(rechazo);
  });

  it("sin cuotas en el body → 1", () => {
    expect(validar({ cuotas: undefined })).toEqual({ ok: true, cuotas: 1 });
  });

  it("el tope es por proveedor: la marca no importa ni hace falta", () => {
    // La entrada ya no tiene marca: cualquier tarjeta de crédito con 6 → ok.
    expect(validar({ cuotas: 6 })).toEqual({ ok: true, cuotas: 6 });
    expect(validar({ cuotas: 7 })).toEqual(rechazo);
  });
});

describe("validarCuotasPago — legacy (clamp 1..24 de siempre)", () => {
  it("cuotasMax null → clamp", () => {
    expect(validar({ cuotasMax: null, cuotas: 12 })).toEqual({ ok: true, cuotas: 12 });
    expect(validar({ cuotasMax: null, cuotas: 30 })).toEqual({ ok: true, cuotas: 1 });
    expect(validar({ cuotasMax: null, cuotas: 2.7 })).toEqual({ ok: true, cuotas: 2 });
    expect(validar({ cuotasMax: null, cuotas: "abc" })).toEqual({ ok: true, cuotas: 1 });
  });

  it("flag off con pedido cuotasMax 3 → 12 se acepta", () => {
    expect(validar({ habilitado: false, cuotasMax: 3, cuotas: 12 })).toEqual({ ok: true, cuotas: 12 });
  });

  it("medio cuenta_mp → sin validación de cuotas", () => {
    expect(validar({ medio: "cuenta_mp", cuotasMax: 1, cuotas: 12 })).toEqual({ ok: true, cuotas: 12 });
  });
});

const oferta = (escalones: { cuotasMax: number; montoMinimo: number }[]): OfertaCuotas => ({
  planesFetchedAt: "2026-09-17T10:00:00.000Z",
  configVersion: "2026-09-17T09:00:00.000Z",
  proveedores: [
    {
      proveedor: "mercadopago",
      nombre: "Mercado Pago",
      orden: 0,
      escalones,
      opciones: [3, 6, 12].map((cuotas) => ({
        cuotas, sinInteres: cuotas <= 6, tasaPct: cuotas <= 6 ? 0 : 30,
        cftPct: null, teaPct: null, montoMin: null, montoMax: null,
      })),
    },
  ],
});

describe("planParaPedido", () => {
  const escalones = [{ cuotasMax: 3, montoMinimo: 0 }, { cuotasMax: 6, montoMinimo: 180000 }];

  it("medio distinto de mercadopago → null", () => {
    expect(planParaPedido("transferencia", 200000, oferta(escalones))).toBeNull();
  });

  it("oferta ilegible (null) → null: cuotas_max null, legacy", () => {
    expect(planParaPedido("mercadopago", 200000, null)).toBeNull();
  });

  it("ningún escalón alcanzado → cuotasMax 1", () => {
    expect(planParaPedido("mercadopago", 100000, oferta([{ cuotasMax: 6, montoMinimo: 150000 }]))).toMatchObject({ cuotasMax: 1 });
  });

  it("pedido 200.000 → cuotasMax 6, sin topes por marca", () => {
    const p = planParaPedido("mercadopago", 200000, oferta(escalones));
    expect(p).toMatchObject({ version: "v2", proveedor: "mercadopago", cuotasMax: 6, totalBase: 200000 });
    expect(p).not.toHaveProperty("maxPorMedio");
  });

  it("total 179.999 → cuotasMax 3", () => {
    expect(planParaPedido("mercadopago", 179999, oferta(escalones))).toMatchObject({ cuotasMax: 3 });
  });

  it("Mercado Pago no configurado en la oferta → cuotasMax 1", () => {
    expect(planParaPedido("mercadopago", 500000, { ...oferta(escalones), proveedores: [] })).toMatchObject({ cuotasMax: 1 });
  });
});
