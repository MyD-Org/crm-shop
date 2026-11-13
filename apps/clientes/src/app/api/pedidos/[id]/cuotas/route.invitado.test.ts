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
vi.mock("@/lib/pedidos", async (original) => {
  const real = await original<typeof import("@/lib/pedidos")>();
  return {
    ...real,
    pedidoParaCambiarMedio: async (id: string, dueno: DuenoPedidos) => {
      repoLlamadas.push(dueno);
      if (!(await import("@/test/aislamiento-invitado")).abre(id, dueno)) return null;
      // Un medio sin cobro en línea: el handler responde 409 `sin_cobro_en_linea` justo después de autorizar.
      return { id, pagoMetodo: "transferencia", entregaTipo: "retiro", lineas: [] };
    },
  };
});

import { POST } from "./route";

describirMatrizAislamiento({
  nombre: "POST /api/pedidos/[id]/cuotas",
  identidad: identidadActual,
  permitir: permitirAsync,
  repoLlamadas,
  conCuerpo: true,
  llamar: ({ token, pedidoId, tokenEnCuerpo }) =>
    POST(pedido(`/api/pedidos/${pedidoId}/cuotas`, { token, tokenEnCuerpo, cuerpo: {} }), {
      params: Promise.resolve({ id: pedidoId }),
    }),
  esFeliz: async (r) => {
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "sin_cobro_en_linea" });
  },
});
