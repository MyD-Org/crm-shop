import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El rescate del pedido pendiente existe para retomar un cobro de Mercado Pago.
 * Con los pagos apagados no hay nada que retomar: el server contesta "no hay"
 * sin consultar la base, aunque el comprador tenga un pedido de MP de antes.
 */

const pendiente = vi.fn();
let pagos = false;

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null }),
}));
vi.mock("@/lib/pedidos", () => ({
  pedidoPendienteMasReciente: (...a: unknown[]) => pendiente(...a),
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: () => pagos }));

import { GET } from "./route";

beforeEach(() => {
  pendiente.mockReset();
  pendiente.mockResolvedValue({ id: "p1", numero: "PED-1", total: 1000, cuotasMax: 6 });
});

describe("GET /api/pedidos/pendiente", () => {
  it("pagos apagados: no hay rescate y ni se consulta la base", async () => {
    pagos = false;
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ pedido: null });
    expect(pendiente).not.toHaveBeenCalled();
  });

  it("pagos prendidos: devuelve el pendiente como siempre", async () => {
    pagos = true;
    const r = await GET();
    expect(await r.json()).toEqual({
      pedido: { id: "p1", numero: "PED-1", total: 1000, cuotasMax: 6 },
    });
    expect(pendiente).toHaveBeenCalledTimes(1);
  });
});
