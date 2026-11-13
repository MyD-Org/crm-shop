import { expect, vi } from "vitest";
import { describirMatrizAislamiento, pedido } from "@/test/aislamiento-invitado";
import type { DuenoPedidos } from "@/lib/pedidos";

const { identidadActual, permitirAsync, repoLlamadas, despues, avisarPedidoSiFalta } = vi.hoisted(() => ({
  identidadActual: vi.fn(),
  permitirAsync: vi.fn(),
  repoLlamadas: [] as DuenoPedidos[],
  despues: [] as (() => Promise<void> | void)[],
  avisarPedidoSiFalta: vi.fn(async () => true),
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (f: () => Promise<void> | void) => {
    despues.push(f);
  },
}));
vi.mock("@/lib/auth", () => ({ identidadActual }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync }));
vi.mock("@/lib/pedido-avisos", () => ({ avisarPedidoSiFalta }));
vi.mock("@/lib/pedidos", () => ({
  esPedidoPropio: async (id: string, dueno: DuenoPedidos) => {
    repoLlamadas.push(dueno);
    return (await import("@/test/aislamiento-invitado")).abre(id, dueno);
  },
}));

import { POST } from "./route";

describirMatrizAislamiento({
  nombre: "POST /api/pedidos/[id]/avisos",
  identidad: identidadActual,
  permitir: permitirAsync,
  repoLlamadas,
  llamar: ({ token, pedidoId }) => {
    despues.length = 0;
    avisarPedidoSiFalta.mockClear();
    return POST(pedido(`/api/pedidos/${pedidoId}/avisos`, { token }), { params: Promise.resolve({ id: pedidoId }) });
  },
  esFeliz: async (r) => {
    expect(r.status).toBe(204);
    await Promise.all(despues.map((f) => f()));
    expect(avisarPedidoSiFalta).toHaveBeenCalledTimes(1);
  },
});
