import { describe, expect, it, vi } from "vitest";
import { ANONIMO, PA, describirMatrizAislamiento, pedido, tokenDe } from "@/test/aislamiento-invitado";
import type { DuenoPedidos } from "@/lib/pedidos";

const { identidadActual, permitirAsync, repoLlamadas, pendienteMasReciente } = vi.hoisted(() => ({
  identidadActual: vi.fn(),
  permitirAsync: vi.fn(),
  repoLlamadas: [] as DuenoPedidos[],
  pendienteMasReciente: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ identidadActual }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync }));
vi.mock("@/lib/pagos", () => ({ procesadorConfigurado: () => true }));
vi.mock("@/lib/pagos/mp-public-key", () => ({ configMpPara: async () => ({}) }));
vi.mock("@/lib/pedidos", () => ({
  pedidoParaReintentarPago: async (dueno: DuenoPedidos, id: string) => {
    repoLlamadas.push(dueno);
    return (await import("@/test/aislamiento-invitado")).abre(id, dueno)
      ? { ok: true, pedido: { id, pagoMetodo: "transferencia", total: 100 } }
      : { ok: false, motivo: "no_existe" };
  },
  pedidoPendienteMasReciente: pendienteMasReciente,
}));

import { GET } from "./route";

describirMatrizAislamiento({
  nombre: "GET /api/pedidos/pendiente?pedido=",
  identidad: identidadActual,
  permitir: permitirAsync,
  repoLlamadas,
  llamar: ({ token, pedidoId }) => GET(pedido(`/api/pedidos/pendiente?pedido=${pedidoId}`, { metodo: "GET", token })),
  esFeliz: async (r) => {
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ pedido: { pagoMetodo: "transferencia" } });
  },
});

describe("GET /api/pedidos/pendiente: el invitado NO lista", () => {
  it("sin ?pedido => 401 aun con un token válido (no hay 'su pedido pendiente más reciente')", async () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", "secreto-de-prueba-pedido-link-0123456789");
    vi.stubEnv("SHOP_TENANT_ID", "tenant-a.example");
    const { setFlag } = await import("@/test/flags");
    setFlag("compra-invitado", true);
    identidadActual.mockResolvedValue(ANONIMO);
    permitirAsync.mockResolvedValue(true);
    pendienteMasReciente.mockClear();
    const r = await GET(pedido("/api/pedidos/pendiente", { metodo: "GET", token: tokenDe(PA) }));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
    expect(pendienteMasReciente).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("GET() sin Request (como lo llaman otros tests) sigue andando para quien tiene sesión", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: "user_ana", cliente: null });
    pendienteMasReciente.mockResolvedValue(null);
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ pedido: null });
  });
});
