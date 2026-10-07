import { beforeEach, describe, expect, it, vi } from "vitest";

/** `?pedido=<id>`: reintento del cobro de un pedido concreto; nunca crea ni busca otro. */

const reintento = vi.fn();
const pendiente = vi.fn();

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null }),
}));
vi.mock("@/lib/pedidos", () => ({
  pedidoPendienteMasReciente: (...a: unknown[]) => pendiente(...a),
  pedidoParaReintentarPago: (...a: unknown[]) => reintento(...a),
}));

import { GET } from "./route";

const pedir = (id: string) => GET(new Request(`https://tienda.example/api/pedidos/pendiente?pedido=${id}`));

beforeEach(() => {
  reintento.mockReset();
  pendiente.mockReset();
});

describe("GET /api/pedidos/pendiente?pedido=", () => {
  it("pedido con el pago rechazado: devuelve ese pedido sin pasar por el rescate genérico", async () => {
    reintento.mockResolvedValue({ ok: true, pedido: { id: "p1", numero: "PED-1", total: 1210, cuotas: null } });
    const r = await pedir("p1");
    expect(r.status).toBe(200);
    expect((await r.json()).pedido.id).toBe("p1");
    expect(reintento).toHaveBeenCalledWith({ clerkUserId: "user_1", clienteCodigo: undefined }, "p1");
    expect(pendiente).not.toHaveBeenCalled();
  });

  it("pedido ajeno o inexistente: 404", async () => {
    reintento.mockResolvedValue({ ok: false, motivo: "no_existe" });
    expect((await pedir("x")).status).toBe(404);
  });

  it("pedido pagado: 409 con mensaje en usted", async () => {
    reintento.mockResolvedValue({ ok: false, motivo: "pagado" });
    const r = await pedir("p1");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("Este pedido ya está pagado.");
  });

  it("pedido no cobrable: 409 y ofrece volver a comprar", async () => {
    reintento.mockResolvedValue({ ok: false, motivo: "no_cobrable" });
    const r = await pedir("p1");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("volver a comprar");
  });
});
