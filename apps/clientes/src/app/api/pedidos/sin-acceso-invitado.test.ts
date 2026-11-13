import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANONIMO, PA, PC, SESION_ANA, pedido, tokenDe } from "@/test/aislamiento-invitado";
import { setFlag } from "@/test/flags";

/**
 * Lo que el invitado NO puede hacer aun con un token válido de su pedido (change
 * `compra-como-invitado`, S2a, A3 / S3-2 / S2-8): listar pedidos, cancelar, geocodificar. Los
 * endpoints de `/api/mi-cuenta/*` no leen el token en absoluto (ver `invitado-superficie.test.ts`).
 */

const { identidadActual, permitirAsync, listarPedidos, cancelarPedidoPendiente, intentoAbierto } = vi.hoisted(() => ({
  identidadActual: vi.fn(),
  permitirAsync: vi.fn(),
  listarPedidos: vi.fn(),
  cancelarPedidoPendiente: vi.fn(),
  intentoAbierto: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ identidadActual }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync }));
vi.mock("@/lib/pedidos", () => ({
  listarPedidos,
  cancelarPedidoPendiente,
  intentoAbiertoDelPedido: intentoAbierto,
  lineasDelPedidoParaCarrito: async () => [],
}));
vi.mock("@/lib/cache-invalidar", () => ({ marcarStockCambiado: () => undefined }));
vi.mock("@/lib/pagos/cuentas-sucursales", () => ({ proveedorDeIntento: async () => null }));
vi.mock("@/lib/pagos/intento-abierto", () => ({ resolverIntentoAbierto: async () => "libre" }));

import { GET as listar } from "./route";
import { POST as cancelar } from "./[id]/cancelar/route";

beforeEach(() => {
  vi.stubEnv("PEDIDO_LINK_SECRET", "secreto-de-prueba-pedido-link-0123456789");
  vi.stubEnv("SHOP_TENANT_ID", "tenant-a.example");
  setFlag("compra-invitado", true);
  for (const f of [identidadActual, permitirAsync, listarPedidos, cancelarPedidoPendiente, intentoAbierto]) f.mockReset();
  identidadActual.mockResolvedValue(ANONIMO);
  permitirAsync.mockResolvedValue(true);
  intentoAbierto.mockResolvedValue(null);
  cancelarPedidoPendiente.mockResolvedValue(true);
});

describe("GET /api/pedidos (la lista)", () => {
  it("el invitado no lista: 401 aun con un token válido, y no se consulta nada", async () => {
    const r = await listar();
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
    expect(listarPedidos).not.toHaveBeenCalled();
  });
});

describe("POST /api/pedidos/[id]/cancelar", () => {
  const llamar = (token: string | null, id = PA) =>
    cancelar(pedido(`/api/pedidos/${id}/cancelar`, { token }), { params: Promise.resolve({ id }) });

  it("token válido de su pedido => 403 en usted que lo manda al local; el pedido NO se cancela", async () => {
    const r = await llamar(tokenDe(PA));
    expect(r.status).toBe(403);
    const j = await r.json();
    expect(j).toMatchObject({ motivo: "invitado_sin_cancelar" });
    expect(j.error).toContain("Comuníquese con el local");
    expect(cancelarPedidoPendiente).not.toHaveBeenCalled();
    expect(intentoAbierto).not.toHaveBeenCalled();
  });

  it("sin token => 401 como hoy; token de otro pedido => 401 (no se entera siquiera de que existe)", async () => {
    expect((await llamar(null)).status).toBe(401);
    expect((await llamar(tokenDe(PA), PC)).status).toBe(401);
    expect(cancelarPedidoPendiente).not.toHaveBeenCalled();
  });

  it("token vencido => 401 con el texto que apunta al enlace del mail", async () => {
    const r = await llamar(tokenDe(PA, { venceEn: Date.now() - 1000 }));
    expect(r.status).toBe(401);
    expect((await r.json()).motivo).toBe("token_vencido");
  });

  it("quien tiene cuenta cancela como siempre, aunque mande un token de invitado", async () => {
    identidadActual.mockResolvedValue(SESION_ANA);
    const r = await llamar(tokenDe(PA), PC);
    expect(r.status).toBe(200);
    expect(cancelarPedidoPendiente).toHaveBeenCalledWith(PC, { clerkUserId: "user_ana", clienteCodigo: undefined });
  });
});

describe("/api/geocode sigue exigiendo sesión", () => {
  it("anónimo con un token válido => 401", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ identidadActual, claveSolicitante: async () => null }));
    vi.doMock("@/lib/rate-limit", () => ({ permitirAsync }));
    const { GET } = await import("@/app/api/geocode/route");
    const r = await GET(pedido("/api/geocode?q=Calle%20Falsa%20123", { metodo: "GET", token: tokenDe(PA) }));
    expect(r.status).toBe(401);
  });
});
