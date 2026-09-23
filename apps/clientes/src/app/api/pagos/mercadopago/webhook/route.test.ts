import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorProveedor, type EstadoPago } from "@/lib/pagos";

/**
 * El webhook no puede descartar un pago cobrado. El caso que lo rompía: el
 * primer intento queda pendiente, el comprador reintenta con otra tarjeta, y
 * después se aprueba el primero. Su referencia ya no estaba en el pedido y la
 * notificación se tiraba como "referencia desconocida".
 */

const consultarPago = vi.fn();
const pedidoDelPago = vi.fn();
const registrarCobro = vi.fn();

vi.mock("@/lib/pagos/mercadopago", () => ({
  mercadoPago: {
    id: "mercadopago",
    verificarWebhook: async () => ({ valido: true, referencia: "r-viejo" }),
    consultarPago: (...a: unknown[]) => consultarPago(...a),
  },
}));
vi.mock("@/lib/pedidos", () => ({
  pedidoDelPago: (...a: unknown[]) => pedidoDelPago(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
}));

import { POST } from "./route";

const notificar = () =>
  POST(new Request("http://localhost/api/pagos/mercadopago/webhook", { method: "POST", body: "{}" }));

const aprobado: EstadoPago = {
  estado: "pagado",
  referencia: "r-viejo",
  detalle: "accredited",
  pedidoId: "00000000-0000-4000-8000-000000000001",
};

beforeEach(() => {
  for (const f of [consultarPago, pedidoDelPago, registrarCobro]) f.mockReset();
  consultarPago.mockResolvedValue(aprobado);
  registrarCobro.mockResolvedValue(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("webhook de Mercado Pago", () => {
  it("referencia conocida: registra el cobro", async () => {
    pedidoDelPago.mockResolvedValue({ id: "p1", pagoEstado: "pendiente" });
    const r = await notificar();
    expect(await r.json()).toEqual({ ok: true, cambio: true });
    expect(pedidoDelPago).toHaveBeenCalledTimes(1);
    expect(registrarCobro).toHaveBeenCalledWith("p1", expect.objectContaining({ referencia: "r-viejo", estado: "pagado" }));
  });

  it("referencia que la base no conoce: encuentra el pedido por external_reference", async () => {
    pedidoDelPago
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "p1", pagoEstado: "pendiente" });
    const r = await notificar();
    expect(r.status).toBe(200);
    expect(pedidoDelPago).toHaveBeenLastCalledWith("mercadopago", "r-viejo", aprobado.pedidoId);
    expect(registrarCobro).toHaveBeenCalledWith("p1", expect.objectContaining({ referencia: "r-viejo" }));
  });

  it("ni por referencia ni por external_reference: 200 ignorado (otro entorno)", async () => {
    pedidoDelPago.mockResolvedValue(null);
    const r = await notificar();
    expect(await r.json()).toMatchObject({ ignorado: "referencia desconocida" });
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it("MP no conoce el pago (404): 200 ignorado, no se reintenta para siempre", async () => {
    pedidoDelPago.mockResolvedValue(null);
    consultarPago.mockRejectedValue(new ErrorProveedor("Mercado Pago respondió 404", 404));
    const r = await notificar();
    expect(r.status).toBe(200);
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it("MP caído: 500 para que MP reintente", async () => {
    pedidoDelPago.mockResolvedValue(null);
    consultarPago.mockRejectedValue(new ErrorProveedor("Mercado Pago respondió 503", 503));
    const r = await notificar();
    expect(r.status).toBe(500);
  });
});
