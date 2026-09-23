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
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => flag }));
// Estos tests son del cobro en sí: corren con los pagos prendidos. El flag
// apagado y el método del pedido se prueban en route.pagos-flag.test.ts.
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: () => true }));

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
    cuotasMax: 3, estado: "pendiente", creadoEn: new Date(),
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

  it("tope por proveedor: cualquier marca hasta el máximo; metodoPagoId sólo viaja a MP", async () => {
    pedido = { ...pedido, cuotasMax: 12 };
    expect((await pagar({ cuotas: 12, metodoPagoId: "master" })).status).toBe(200);
    expect(crearPago).toHaveBeenLastCalledWith(expect.objectContaining({ cuotas: 12, metodoPagoId: "master" }));
    expect((await pagar({ cuotas: 13, metodoPagoId: "visa" })).status).toBe(422);
  });

  it("sin metodoPagoId dentro del máximo → se cobra (ya no es obligatorio)", async () => {
    expect((await pagar({ cuotas: 3 })).status).toBe(200);
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ cuotas: 3, metodoPagoId: undefined }));
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
    pedido = { ...pedido, cuotasMax: null };
    expect((await pagar({ cuotas: 12, metodoPagoId: "visa" })).status).toBe(200);
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ cuotas: 12 }));
  });

  it("flag apagado con pedido cuotasMax 3 → 12 se acepta (clamp)", async () => {
    flag = false;
    expect((await pagar({ cuotas: 12, metodoPagoId: "visa" })).status).toBe(200);
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ cuotas: 12 }));
  });
});
