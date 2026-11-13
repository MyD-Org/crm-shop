import { expect, vi } from "vitest";
import { describirMatrizAislamiento, pedido } from "@/test/aislamiento-invitado";
import type { DuenoPedidos } from "@/lib/pedidos";

const { identidadActual, permitirAsync, repoLlamadas } = vi.hoisted(() => ({
  identidadActual: vi.fn(),
  permitirAsync: vi.fn(),
  repoLlamadas: [] as DuenoPedidos[],
}));
vi.mock("@/lib/auth", () => ({ identidadActual }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync }));
vi.mock("@/lib/pagos/estado-pago-pedido", () => ({
  estadoPagoDelPedido: async (id: string, dueno: DuenoPedidos) => {
    repoLlamadas.push(dueno);
    return (await import("@/test/aislamiento-invitado")).abre(id, dueno)
      ? { estado: "pendiente", enLinea: true, cobrable: true }
      : null;
  },
}));

import { GET } from "./route";

describirMatrizAislamiento({
  nombre: "GET /api/pedidos/[id]/pago",
  identidad: identidadActual,
  permitir: permitirAsync,
  repoLlamadas,
  llamar: ({ token, pedidoId }) =>
    GET(pedido(`/api/pedidos/${pedidoId}/pago`, { metodo: "GET", token }), { params: Promise.resolve({ id: pedidoId }) }),
  esFeliz: async (r) => {
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ estado: "pendiente", enLinea: true, cobrable: true });
  },
});
