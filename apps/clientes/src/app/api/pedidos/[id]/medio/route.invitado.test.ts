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
    // El pedido existe sólo si el dueño con el que se pregunta lo abre (misma regla que `esDeSuDueno`).
    pedidoParaCambiarMedio: async (id: string, dueno: DuenoPedidos) => {
      repoLlamadas.push(dueno);
      if (!(await import("@/test/aislamiento-invitado")).abre(id, dueno)) return null;
      return {
        id,
        pagoMetodo: "mercadopago",
        entregaTipo: "retiro",
        entrega: {},
        contacto: { nombre: "Ana", telefono: "1100000000" },
        lineas: [],
        // Con una revisión de pago el POST corta en 409 justo después de autorizar: prueba que llegó con el dueño correcto.
        pagoRevision: "monto_distinto",
      };
    },
    lineasDelPedidoParaCarrito: async () => [{ id: "i1", qty: 1 }],
  };
});

import { GET, POST } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describirMatrizAislamiento({
  nombre: "GET /api/pedidos/[id]/medio",
  identidad: identidadActual,
  permitir: permitirAsync,
  repoLlamadas,
  llamar: ({ token, pedidoId }) => GET(pedido(`/api/pedidos/${pedidoId}/medio`, { metodo: "GET", token }), ctx(pedidoId)),
  esFeliz: async (r) => {
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo).toMatchObject({ items: [{ id: "i1" }], contacto: { nombre: "Ana" } });
  },
});

describirMatrizAislamiento({
  nombre: "POST /api/pedidos/[id]/medio",
  identidad: identidadActual,
  permitir: permitirAsync,
  repoLlamadas,
  conCuerpo: true,
  llamar: ({ token, pedidoId, tokenEnCuerpo }) =>
    POST(pedido(`/api/pedidos/${pedidoId}/medio`, { token, tokenEnCuerpo, cuerpo: { pagoMetodo: "transferencia" } }), ctx(pedidoId)),
  esFeliz: async (r) => {
    // Autorizado y encontrado: el handler siguió hasta la regla de negocio (pago en revisión).
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "pago_en_revision" });
  },
});
