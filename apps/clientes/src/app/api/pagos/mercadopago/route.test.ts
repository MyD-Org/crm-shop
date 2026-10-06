import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";

/** Enforcement de cuotas en la ruta de pago (L8): 422 SIN llamar al proveedor. */

const crearPago = vi.fn();
const registrarCobro = vi.fn();
let pedido: PedidoParaPago;
let flag = true;

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@b.com" }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  reservarIntento: async () => ({ intentoId: "i1" }),
  getPedidoParaPago: async () => pedido,
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
  registrarIntentoFallido: async () => undefined,
}));
vi.mock("@/lib/pagos/intento-abierto", () => ({
  resolverIntentoAbierto: async () => "en_curso",
}));
vi.mock("@/lib/pagos/mercadopago", () => ({
  mercadoPago: { id: "mercadopago", crearPago: (...a: unknown[]) => crearPago(...a) },
  urlNotificacion: () => undefined,
  mercadoPagoConfigurado: () => true,
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => flag }));
// Estos tests son del cobro en sí. Las credenciales y el método del pedido se prueban en
// route.medio.test.ts.

import { POST } from "./route";

const pagar = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/pagos/mercadopago", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", medio: "tarjeta", token: "tok", ...body }),
    }),
  );

beforeEach(() => {
  flag = true;
  pedido = {
    id: "p1", numero: "PED-1", total: 120000, pagoEstado: "pendiente", pagoMetodo: "mercadopago",
    clienteEmail: "a@b.com", facturacionTipoDoc: null, facturacionNroDoc: null,
    cuotas: 3, estado: "pendiente", creadoEn: new Date(),
  };
  crearPago.mockReset();
  crearPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "accredited" });
  registrarCobro.mockReset();
});

describe("POST /api/pagos/mercadopago — cuotas (igualdad con lo congelado)", () => {
  it("POST manipulado: 12 cuotas con un pedido en 3 → 422 y el procesador no se llama", async () => {
    const r = await pagar({ cuotas: 12, metodoPagoId: "visa" });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      error: "La cantidad de cuotas no coincide con la seleccionada. Vuelva a elegir su medio de pago.",
      motivo: "cuotas_distintas",
    });
    expect(crearPago).toHaveBeenCalledTimes(0);
    expect(registrarCobro).toHaveBeenCalledTimes(0);
  });

  it("MENOS cuotas que las congeladas también se rechaza (el comprador bajó la cantidad en el formulario)", async () => {
    expect((await pagar({ cuotas: 1 })).status).toBe(422);
    expect((await pagar({ cuotas: 2 })).status).toBe(422);
    expect(crearPago).not.toHaveBeenCalled();
  });

  it("las mismas cuotas: se cobra con esas cuotas y el MONTO del pedido (nunca el del body)", async () => {
    expect((await pagar({ cuotas: 3, metodoPagoId: "visa", monto: 1, total: 1, transaction_amount: 1 })).status).toBe(200);
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ cuotas: 3, monto: 120000, metodoPagoId: "visa" }));
  });

  it("sin metodoPagoId se cobra igual", async () => {
    expect((await pagar({ cuotas: 3 })).status).toBe(200);
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ cuotas: 3, metodoPagoId: undefined }));
  });

  it("cuotas no enteras → 422", async () => {
    expect((await pagar({ cuotas: 2.5, metodoPagoId: "visa" })).status).toBe(422);
    expect((await pagar({ cuotas: "abc", metodoPagoId: "visa" })).status).toBe(422);
    expect(crearPago).not.toHaveBeenCalled();
  });

  it("pedido en un pago (1): sólo 1", async () => {
    pedido = { ...pedido, cuotas: 1 };
    expect((await pagar({ cuotas: 1 })).status).toBe(200);
    expect((await pagar({ cuotas: 6 })).status).toBe(422);
  });

  it("pedido sin cuotas congeladas (flag apagado al crearlo o anterior): clamp 1..24 de siempre", async () => {
    pedido = { ...pedido, cuotas: null };
    expect((await pagar({ cuotas: 12, metodoPagoId: "visa" })).status).toBe(200);
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ cuotas: 12 }));
  });

  it("lo congelado manda aunque el flag se apague después", async () => {
    flag = false;
    expect((await pagar({ cuotas: 12, metodoPagoId: "visa" })).status).toBe(422);
    expect((await pagar({ cuotas: 3, metodoPagoId: "visa" })).status).toBe(200);
  });
});
