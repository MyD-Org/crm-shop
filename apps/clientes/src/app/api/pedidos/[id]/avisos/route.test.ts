import { beforeEach, describe, expect, it, vi } from "vitest";

const identidadActual = vi.fn();
const esPedidoPropio = vi.fn();
const avisarPedidoSiFalta = vi.fn(async () => true);
const despues: (() => Promise<void> | void)[] = [];

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (f: () => Promise<void> | void) => {
    despues.push(f);
  },
}));
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidadActual() }));
vi.mock("@/lib/pedidos", () => ({ esPedidoPropio: (...a: unknown[]) => esPedidoPropio(...a) }));
vi.mock("@/lib/pedido-avisos", () => ({ avisarPedidoSiFalta: (...a: unknown[]) => avisarPedidoSiFalta(...(a as [])) }));

import { POST } from "./route";

const llamar = (id = "p1") =>
  POST(new Request(`https://tienda.example/api/pedidos/${id}/avisos`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  for (const f of [identidadActual, esPedidoPropio, avisarPedidoSiFalta]) f.mockReset();
  despues.length = 0;
  identidadActual.mockResolvedValue({ clerkUserId: "user_avisos", cliente: null });
  esPedidoPropio.mockResolvedValue(true);
});

describe("POST /api/pedidos/:id/avisos", () => {
  it("pedido propio: 204 y los avisos salen (si faltaban) después de responder", async () => {
    const r = await llamar();
    expect(r.status).toBe(204);
    expect(esPedidoPropio).toHaveBeenCalledWith("p1", { clerkUserId: "user_avisos", clienteCodigo: undefined });
    await Promise.all(despues.map((f) => f()));
    expect(avisarPedidoSiFalta).toHaveBeenCalledWith("p1");
  });

  it("pedido ajeno o inexistente: 404 y no avisa", async () => {
    esPedidoPropio.mockResolvedValue(false);
    expect((await llamar()).status).toBe(404);
    expect(despues).toHaveLength(0);
  });

  it("sin sesión: 401", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await llamar()).status).toBe(401);
  });
});
