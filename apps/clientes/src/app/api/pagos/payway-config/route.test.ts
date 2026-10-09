import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const identidadActual = vi.fn();
const getPedidoParaPago = vi.fn();

vi.mock("@/lib/auth", () => ({ identidadActual: () => identidadActual() }));
vi.mock("@/lib/pedidos", () => ({
  cuentasRechazadasDelPedido: async () => [],
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
}));
vi.mock("@/lib/tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: async () => [{ slug: "igz", activa: true, predeterminada: true }, { slug: "mdp", activa: true, predeterminada: false }] }),
    }),
  }),
}));

import { GET } from "./route";
import { limpiarMemoCuentas } from "@/lib/pagos/cuentas-sucursales";

const pedido = (sucursal: string | null, pagoMetodo = "payway") => ({ id: "p1", pagoMetodo, sucursal, facturaSucursal: null });
const pedir = (id = "p1") => GET(new Request(`https://tienda.example/api/pagos/payway-config?pedido=${id}`));

beforeEach(() => {
  limpiarMemoCuentas();
  identidadActual.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
  getPedidoParaPago.mockResolvedValue(pedido("mdp"));
  vi.stubEnv("PAYWAY_BASE_URL", "https://payway.example/api/v2");
  vi.stubEnv("PAYWAY_API_PRIVATE_KEY_MDP", "privada-mdp");
  vi.stubEnv("PAYWAY_API_PUBLIC_KEY_MDP", "publica-mdp");
  vi.stubEnv("PAYWAY_API_PRIVATE_KEY_IGZ", "privada-igz");
  vi.stubEnv("PAYWAY_API_PUBLIC_KEY_IGZ", "publica-igz");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/pagos/payway-config?pedido=", () => {
  it("pedido de mdp: la cuenta, la key pública de mdp y la base, sin cachear", async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ cuenta: "mdp", publicKey: "publica-mdp", baseUrl: "https://payway.example" });
    expect(r.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(getPedidoParaPago).toHaveBeenCalledWith("p1", { clerkUserId: "user_1", clienteCodigo: undefined });
  });

  it("pedido de igz: la key de igz; sin sucursal: la predeterminada", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("igz"));
    expect((await (await pedir()).json()).publicKey).toBe("publica-igz");
    getPedidoParaPago.mockResolvedValue(pedido(null));
    expect((await (await pedir()).json()).cuenta).toBe("igz");
  });

  it("nunca devuelve la key privada", async () => {
    expect(JSON.stringify(await (await pedir()).json())).not.toContain("privada");
  });

  it("sin sesión -> 401", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await pedir()).status).toBe(401);
    expect(getPedidoParaPago).not.toHaveBeenCalled();
  });

  it("pedido ajeno o inexistente -> 404 sin revelar datos", async () => {
    getPedidoParaPago.mockResolvedValue(null);
    const r = await pedir();
    expect(r.status).toBe(404);
    expect(JSON.stringify(await r.json())).not.toContain("publica");
  });

  it("sin ?pedido= o pedido de otro procesador -> 404", async () => {
    expect((await GET(new Request("https://tienda.example/api/pagos/payway-config"))).status).toBe(404);
    getPedidoParaPago.mockResolvedValue(pedido("mdp", "mercadopago"));
    expect((await pedir()).status).toBe(404);
  });

  it("la cuenta del pedido sin configurar -> la config de la otra cuenta configurada", async () => {
    vi.stubEnv("PAYWAY_API_PUBLIC_KEY_MDP", "");
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ cuenta: "igz", publicKey: "publica-igz", baseUrl: "https://payway.example" });
  });

  it("ninguna cuenta configurada -> 409 en usted, sin keys", async () => {
    vi.stubEnv("PAYWAY_API_PUBLIC_KEY_MDP", "");
    vi.stubEnv("PAYWAY_API_PUBLIC_KEY_IGZ", "");
    const r = await pedir();
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toMatch(/no están disponibles/);
    expect(JSON.stringify(j)).not.toContain("publica-igz");
  });
});
