import { describe, expect, it } from "vitest";
import { camposCuotasCobro, formatearNumero, transicionPermitida } from "./pedidos";
import type { PagoEstado } from "@/data/orders";

describe("formatearNumero", () => {
  it("formatea el correlativo con ceros a la izquierda", () => {
    expect(formatearNumero(1000)).toBe("PED-00001000");
    expect(formatearNumero(7)).toBe("PED-00000007");
  });

  it("no rompe si el número supera el ancho previsto", () => {
    expect(formatearNumero(123456789)).toBe("PED-123456789");
  });
});

/**
 * Las notificaciones de pago llegan desordenadas y repetidas. Sin estas reglas,
 * un evento viejo puede desmarcar un cobro bueno y dejar un pedido pagado como
 * pendiente — peor que no procesarlo, porque nadie se entera de que pasó.
 */
describe("transicionPermitida", () => {
  const estados: PagoEstado[] = ["pendiente", "pagado", "fallido"];

  it("nunca reprocesa el mismo estado", () => {
    for (const e of estados) {
      expect(transicionPermitida(e, e), e).toBe(false);
    }
  });

  it("deja avanzar desde pendiente", () => {
    expect(transicionPermitida("pendiente", "pagado")).toBe(true);
    expect(transicionPermitida("pendiente", "fallido")).toBe(true);
  });

  /** Un reintento exitoso después de un rechazo es perfectamente legítimo. */
  it("deja recuperarse desde fallido", () => {
    expect(transicionPermitida("fallido", "pagado")).toBe(true);
    expect(transicionPermitida("fallido", "pendiente")).toBe(true);
  });

  /**
   * EL CASO QUE IMPORTA. Un evento viejo o duplicado no puede desmarcar un pago
   * confirmado.
   */
  it("de pagado NO se baja", () => {
    expect(transicionPermitida("pagado", "pendiente")).toBe(false);
    expect(transicionPermitida("pagado", "fallido")).toBe(false);
  });

  /**
   * La única excepción: un contracargo o una devolución significan que la plata
   * efectivamente se fue, y el pedido tiene que reflejarlo.
   */
  it("de pagado sí se baja con un contracargo", () => {
    expect(transicionPermitida("pagado", "fallido", true)).toBe(true);
  });

  it("ni siquiera un contracargo devuelve un pago a pendiente", () => {
    // "Pendiente" significa "todavía no se sabe", y de un contracargo sí se
    // sabe: la plata volvió al comprador.
    expect(transicionPermitida("pagado", "pendiente", true)).toBe(false);
  });
});

/** Cuotas reales y total pagado (L9): se guardan aparte, el total del pedido no se toca. */
describe("camposCuotasCobro", () => {
  const base = { proveedor: "mercadopago", referencia: "1", estado: "pagado" as const, detalle: "accredited" };

  it("6 cuotas / 144.000 → pago_cuotas y pago_total_pagado, nunca total", () => {
    const c = camposCuotasCobro({ ...base, cuotas: 6, totalPagado: 144000 });
    expect(c).toEqual({ pagoCuotas: 6, pagoTotalPagado: "144000.00" });
    expect(c).not.toHaveProperty("total");
  });

  it("sin datos del proveedor → no pisa nada", () => {
    expect(camposCuotasCobro(base)).toEqual({});
  });

  it("valores inválidos se ignoran", () => {
    expect(camposCuotasCobro({ ...base, cuotas: 0, totalPagado: -1 })).toEqual({});
    expect(camposCuotasCobro({ ...base, cuotas: 2.5, totalPagado: Number.NaN })).toEqual({});
  });

  it("mismo evento dos veces → mismos campos (idempotente)", () => {
    const cobro = { ...base, cuotas: 3, totalPagado: 120000.5 };
    expect(camposCuotasCobro(cobro)).toEqual(camposCuotasCobro(cobro));
  });
});
