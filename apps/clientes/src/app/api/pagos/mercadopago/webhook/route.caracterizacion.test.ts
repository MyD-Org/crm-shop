import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CARACTERIZACIÓN del webhook de Mercado Pago (rebanada A de payway-cobro): firma, ignorados y
 * aplicación del cobro. La URL registrada en MP no cambia; esto tiene que pasar igual antes y después.
 */

const verificarWebhook = vi.fn();
const consultarPago = vi.fn();
const pedidoDelPago = vi.fn();
const registrarCobro = vi.fn();

vi.mock("@/lib/pagos/mercadopago", () => ({
  mercadoPago: {
    id: "mercadopago",
    verificarWebhook: (...a: unknown[]) => verificarWebhook(...a),
    consultarPago: (...a: unknown[]) => consultarPago(...a),
  },
}));
vi.mock("@/lib/pedidos", () => ({
  pedidoDelPago: (...a: unknown[]) => pedidoDelPago(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
}));

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => undefined,
}));

import { GET, POST } from "./route";

const notificar = (cuerpo = '{"data":{"id":"r1"}}') =>
  POST(new Request("https://tienda.example/api/pagos/mercadopago/webhook", { method: "POST", body: cuerpo }));

beforeEach(() => {
  for (const f of [verificarWebhook, consultarPago, pedidoDelPago, registrarCobro]) f.mockReset();
  verificarWebhook.mockResolvedValue({ valido: true, referencia: "r1" });
  pedidoDelPago.mockResolvedValue({ id: "p1", pagoEstado: "pendiente" });
  consultarPago.mockResolvedValue({
    estado: "pagado",
    referencia: "r1",
    detalle: "accredited",
    cuotasPagadas: 3,
    totalPagado: 130,
    reversion: false,
  });
  registrarCobro.mockResolvedValue(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("webhook de Mercado Pago — caracterización", () => {
  it("firma inválida → 401 sin consultar ni escribir", async () => {
    verificarWebhook.mockResolvedValue({ valido: false });
    const r = await notificar();
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Firma inválida" });
    expect(consultarPago).not.toHaveBeenCalled();
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it("verifica sobre el cuerpo crudo", async () => {
    await notificar("cuerpo-crudo");
    expect(verificarWebhook).toHaveBeenCalledWith(expect.any(Request), "cuerpo-crudo");
  });

  it("firma válida sin referencia → 200 ignorado", async () => {
    verificarWebhook.mockResolvedValue({ valido: true });
    const r = await notificar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, ignorado: "sin referencia" });
    expect(consultarPago).not.toHaveBeenCalled();
  });

  it("aplica el cobro con lo que dice el proveedor, no con el payload", async () => {
    const r = await notificar();
    expect(await r.json()).toEqual({ ok: true, cambio: true });
    expect(pedidoDelPago).toHaveBeenCalledWith("mercadopago", "r1");
    expect(consultarPago).toHaveBeenCalledWith("r1");
    expect(registrarCobro).toHaveBeenCalledWith("p1", {
      proveedor: "mercadopago",
      referencia: "r1",
      estado: "pagado",
      detalle: "accredited",
      reversion: false,
      cuotas: 3,
      totalPagado: 130,
    });
  });

  it("GET (verificación del panel de MP) → 200 ok", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
});
