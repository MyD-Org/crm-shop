import { describe, expect, it } from "vitest";
import {
  armarOrder,
  camposCuotasCobro,
  formatearNumero,
  transicionPermitida,
  type FilaItem,
  type FilaOrder,
} from "./pedidos";
import type { PagoEstado } from "@/data/orders";
import type { Product } from "@/data/products";

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

/**
 * Líneas de pedido con el nombre real: `order_items.name` guarda el código
 * (así lo congela la cotización), así que el nombre visible sale del espejo
 * del catálogo si el ítem sigue ahí.
 */
describe("armarOrder", () => {
  const fila = {
    id: "p-1",
    numero: 1042,
    createdAt: new Date("2026-09-01T12:00:00Z"),
    estado: "preparacion",
    pagoEstado: "pagado",
    pagoMetodo: "transferencia",
    entregaTipo: "envio",
    entregaCiudad: "Ciudad Ejemplo",
    entregaDireccion: null,
    subtotal: "1000.00",
    iva: "210.00",
    costoEnvio: "0.00",
    total: "1210.00",
  } as unknown as FilaOrder;

  const linea = (extra: Partial<FilaItem> = {}) =>
    ({
      id: "l-1",
      orderId: "p-1",
      alegraItemId: "42",
      code: null,
      name: "02141N",
      brand: "Marca Ejemplo",
      qty: "2.000",
      precioUnitario: "500.00",
      ivaPorcentaje: "21.00",
      subtotal: "1000.00",
      iva: "210.00",
      total: "1210.00",
      ...extra,
    }) as FilaItem;

  const lampara: Product = {
    id: "42",
    name: "Lámpara LED A60 9W E27",
    brand: "Marca Ejemplo",
    price: 500,
    stock: "in",
    sku: "02141N",
    images: [{ url: "https://media.plataforma.example/42.jpg", w: 800 }],
  };

  it("con el producto en el espejo: nombre real, código y foto", () => {
    const order = armarOrder(fila, [linea()], new Map([["42", lampara]]));
    expect(order.items[0]).toMatchObject({
      id: "42",
      name: "02141N",
      nombreVisible: "Lámpara LED A60 9W E27",
      codigo: "02141N",
      imagen: { url: "https://media.plataforma.example/42.jpg", w: 800 },
      qty: 2,
    });
  });

  it("sin el producto en el espejo: el snapshot de la línea, sin foto", () => {
    const [item] = armarOrder(fila, [linea()], new Map()).items;
    expect(item.nombreVisible).toBe("02141N");
    expect(item.codigo).toBe("02141N");
    expect(item.imagen).toBeUndefined();
  });

  it("el code congelado en la línea gana sobre el sku del espejo", () => {
    const [item] = armarOrder(fila, [linea({ code: "REF-1" })], new Map([["42", lampara]])).items;
    expect(item.codigo).toBe("REF-1");
  });

  it("expone el tipo de entrega crudo y conserva la etiqueta", () => {
    const order = armarOrder(fila, [], new Map());
    expect(order.entregaTipo).toBe("envio");
    expect(order.metodoEntrega).not.toBe("envio");
    expect(order.facturaId).toBeUndefined();
  });
});
