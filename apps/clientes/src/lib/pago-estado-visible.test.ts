import { describe, expect, it } from "vitest";
import { ocultarEstadoPago, pagoEstadoVista } from "./pago-estado-visible";

/**
 * "Pago pendiente" sólo tiene sentido en un pedido que se cobra en línea (Mercado Pago). Un pedido
 * con transferencia o efectivo queda "a confirmar": decirle al comprador que tiene un pago
 * pendiente en el Shop sería confuso. Lo decide cada pedido, no un flag global.
 */
describe("ocultarEstadoPago", () => {
  it("pedido que no es de Mercado Pago: oculta sólo el 'pendiente'", () => {
    expect(ocultarEstadoPago("pendiente", "transferencia")).toBe(true);
    expect(ocultarEstadoPago("pendiente", "a_coordinar")).toBe(true);
    expect(ocultarEstadoPago("pendiente", undefined)).toBe(true);
    expect(ocultarEstadoPago("pagado", "transferencia")).toBe(false);
    expect(ocultarEstadoPago("fallido", "transferencia")).toBe(false);
  });

  it("pedido de Mercado Pago: no oculta nada", () => {
    expect(ocultarEstadoPago("pendiente", "mercadopago")).toBe(false);
    expect(ocultarEstadoPago("pagado", "mercadopago")).toBe(false);
    expect(ocultarEstadoPago("fallido", "mercadopago")).toBe(false);
  });
});

describe("pagoEstadoVista", () => {
  it("pago en línea ya enviado al procesador y sin resolver: 'Pago en proceso', con el detalle de qué esperar", () => {
    const v = pagoEstadoVista({ pagoEstado: "pendiente", pagoMetodoSlug: "payway", pagoEnProceso: true });
    expect(v?.label).toBe("Pago en proceso");
    expect(v?.detalle).toMatch(/correo/);
  });

  it("pago en línea que todavía no se intentó: 'Pago pendiente'", () => {
    expect(pagoEstadoVista({ pagoEstado: "pendiente", pagoMetodoSlug: "payway" })).toEqual({ label: "Pago pendiente" });
  });

  it("aprobado y rechazado se dicen claro, con el medio que sea", () => {
    expect(pagoEstadoVista({ pagoEstado: "pagado", pagoMetodoSlug: "transferencia" })?.label).toBe("Pago aprobado");
    const r = pagoEstadoVista({ pagoEstado: "fallido", pagoMetodoSlug: "payway" });
    expect(r?.label).toBe("Pago rechazado");
    expect(r?.detalle).toMatch(/intentar/);
  });

  it("un pedido que no se cobra en línea no muestra el 'pendiente'", () => {
    expect(pagoEstadoVista({ pagoEstado: "pendiente", pagoMetodoSlug: "transferencia" })).toBeNull();
  });
});
