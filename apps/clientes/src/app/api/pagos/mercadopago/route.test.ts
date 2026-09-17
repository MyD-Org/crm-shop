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
vi.mock("@/lib/pedidos", () => ({
  getPedidoParaPago: async () => pedido,
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
  registrarIntentoFallido: async () => undefined,
}));
vi.mock("@/lib/pagos/mercadopago", () => ({
  mercadoPago: { id: "mercadopago", crearPago: (...a: unknown[]) => crearPago(...a) },
  urlNotificacion: () => undefined,
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => flag }));

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
    cuotasMax: 3, cuotasMaxPorMedio: { visa: 3, master: 3 },
  };
  crearPago.mockReset();
  crearPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "accredited" });
  registrarCobro.mockReset();
});

describe("POST /api/pagos/mercadopago — cuotas", () => {
  it("POST manipulado: 12 cuotas con máximo 3 → 422 y crearPago no se llama", async () => {
    const r = await pagar({ cuotas: 12, metodoPagoId: "visa" });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      error: "Esa cantidad de cuotas no está disponible para tu tarjeta. Elegí otra opción de cuotas.",
      motivo: "cuotas_no_disponibles",
    });
    expect(crearPago).toHaveBeenCalledTimes(0);
    expect(registrarCobro).toHaveBeenCalledTimes(0);
  });

  it("límite por medio: master 12 con {visa:12, master:6} → 422; visa 12 → se cobra", async () => {
    pedido = { ...pedido, cuotasMax: 12, cuotasMaxPorMedio: { visa: 12, master: 6 } };
    expect((await pagar({ cuotas: 12, metodoPagoId: "master" })).status).toBe(422);
    expect(crearPago).not.toHaveBeenCalled();

    expect((await pagar({ cuotas: 12, metodoPagoId: "visa" })).status).toBe(200);
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ cuotas: 12, metodoPagoId: "visa" }));
  });

  it("dentro del máximo → se cobra con esas cuotas", async () => {
    expect((await pagar({ cuotas: 3, metodoPagoId: "visa" })).status).toBe(200);
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ cuotas: 3 }));
  });

  it("cuotas no enteras → 422", async () => {
    expect((await pagar({ cuotas: 2.5, metodoPagoId: "visa" })).status).toBe(422);
    expect((await pagar({ cuotas: "abc", metodoPagoId: "visa" })).status).toBe(422);
    expect(crearPago).not.toHaveBeenCalled();
  });

  it("pedido legacy (cuotasMax null) → clamp 1..24 de siempre", async () => {
    pedido = { ...pedido, cuotasMax: null, cuotasMaxPorMedio: null };
    expect((await pagar({ cuotas: 12, metodoPagoId: "visa" })).status).toBe(200);
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ cuotas: 12 }));
  });

  it("flag apagado con pedido cuotasMax 3 → 12 se acepta (clamp)", async () => {
    flag = false;
    expect((await pagar({ cuotas: 12, metodoPagoId: "visa" })).status).toBe(200);
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ cuotas: 12 }));
  });
});
