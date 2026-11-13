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
vi.mock("@/lib/pedidos", () => ({
  getPedidoParaPago: async (id: string, dueno: DuenoPedidos) => {
    repoLlamadas.push(dueno);
    return (await import("@/test/aislamiento-invitado")).abre(id, dueno) ? { id, pagoMetodo: "payway" } : null;
  },
}));
vi.mock("@/lib/pagos/cuentas-sucursales", () => ({
  cuentaParaCobrar: async () => ({ ok: true, cuenta: "igz", prevista: "igz", fallback: false }),
}));
vi.mock("@/lib/pagos/payway", () => ({
  paywayConfigPublica: (cuenta: string) => ({ cuenta, publicKey: "clave-publica-de-prueba", baseUrl: "https://payway.example" }),
}));

import { GET } from "./route";

describirMatrizAislamiento({
  nombre: "GET /api/pagos/payway-config?pedido=",
  identidad: identidadActual,
  permitir: permitirAsync,
  repoLlamadas,
  llamar: ({ token, pedidoId }) => GET(pedido(`/api/pagos/payway-config?pedido=${pedidoId}`, { metodo: "GET", token })),
  esFeliz: async (r) => {
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toMatchObject({ cuenta: "igz", publicKey: "clave-publica-de-prueba" });
  },
});
