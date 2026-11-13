import { describe, expect, it, vi } from "vitest";
import { ANONIMO, PA, describirMatrizAislamiento, pedido, tokenDe } from "@/test/aislamiento-invitado";
import { setFlag } from "@/test/flags";
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
    getPedidoParaPago: async (id: string, dueno: DuenoPedidos) => {
      repoLlamadas.push(dueno);
      // Ya pagado: el handler responde 409 `pedido_no_cobrable` justo después de autorizar y encontrar el pedido.
      return (await import("@/test/aislamiento-invitado")).abre(id, dueno)
        ? { id, pagoMetodo: "payway", pagoEstado: "pagado", estado: "pendiente", creadoEn: new Date() }
        : null;
    },
    registrarCuentaRechazada: vi.fn(),
  };
});
vi.mock("@/lib/pagos/cuentas-sucursales", () => ({ cuentaParaCobrar: vi.fn() }));

import { POST } from "./route";

const cuerpo = (pedidoId: string) => ({ pedidoId, proveedor: "payway", cuenta: "igz" });

describirMatrizAislamiento({
  nombre: "POST /api/pagos/cuenta-rechazada",
  identidad: identidadActual,
  permitir: permitirAsync,
  repoLlamadas,
  conCuerpo: true,
  llamar: ({ token, pedidoId, tokenEnCuerpo }) =>
    POST(pedido("/api/pagos/cuenta-rechazada", { token, tokenEnCuerpo, cuerpo: cuerpo(pedidoId) })),
  esFeliz: async (r) => {
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "pedido_no_cobrable" });
  },
});

describe("POST /api/pagos/cuenta-rechazada: cuerpo ilegible", () => {
  it("anónimo con cuerpo ilegible => 401 (como hoy); con sesión => 400", async () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", "secreto-de-prueba-pedido-link-0123456789");
    vi.stubEnv("SHOP_TENANT_ID", "tenant-a.example");
    setFlag("compra-invitado", true);
    permitirAsync.mockResolvedValue(true);
    const malo = (token: string | null) =>
      new Request("https://shop.example/api/pagos/cuenta-rechazada", {
        method: "POST",
        headers: token ? { "x-pedido-token": token } : {},
        body: "{no",
      });
    identidadActual.mockResolvedValue(ANONIMO);
    expect((await POST(malo(tokenDe(PA)))).status).toBe(401);
    identidadActual.mockResolvedValue({ clerkUserId: "user_ana", cliente: null });
    expect((await POST(malo(null))).status).toBe(400);
    vi.unstubAllEnvs();
  });
});
