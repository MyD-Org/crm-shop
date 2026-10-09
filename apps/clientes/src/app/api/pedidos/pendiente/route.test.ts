import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El rescate del pedido pendiente existe para retomar un cobro de Mercado Pago. Sin credenciales
 * no hay nada que retomar: el server contesta "no hay" sin consultar la base. Con el medio
 * desactivado en el CRM sí se rescata (el pedido ya existe): acá no se mira la tabla de medios.
 */

const pendiente = vi.fn();

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null }),
}));
vi.mock("@/lib/pedidos", () => ({
  cuentasRechazadasDelPedido: async () => [],
  pedidoPendienteMasReciente: (...a: unknown[]) => pendiente(...a),
  // Cuenta de cobro del pedido retomado: sucursal mdp.
  cuentaDelPedido: async () => ({ sucursal: "mdp", facturaSucursal: null }),
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));

import { GET } from "./route";

beforeEach(() => {
  pendiente.mockReset();
  pendiente.mockResolvedValue({ id: "p1", numero: "PED-1", total: 1000, cuotas: 6 });
  vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token");
  vi.stubEnv("MP_PUBLIC_KEY_MDP", "TEST-key-mdp");
  vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token");
  vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-key-igz");
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/pedidos/pendiente", () => {
  it("sin credenciales de Mercado Pago en ninguna cuenta: no hay rescate y ni se consulta la base", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "");
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ pedido: null });
    expect(pendiente).not.toHaveBeenCalled();
  });

  it("con credenciales: devuelve el pendiente", async () => {
    const r = await GET();
    expect(await r.json()).toEqual({
      pedido: { id: "p1", numero: "PED-1", total: 1000, cuotas: 6 },
    });
    expect(pendiente).toHaveBeenCalledTimes(1);
  });

  it("pedido de Mercado Pago: suma la public key de la cuenta de ESE pedido (mdp) y la cuenta", async () => {
    pendiente.mockResolvedValue({ id: "p1", numero: "PED-1", total: 1000, cuotas: 1, pagoMetodo: "mercadopago" });
    expect((await (await GET()).json()).pedido).toMatchObject({ mpPublicKey: "TEST-key-mdp", mpCuenta: "mdp" });
  });

  it("la cuenta del pedido sin credenciales: sin public key (no la de otra sucursal)", async () => {
    vi.stubEnv("MP_PUBLIC_KEY_MDP", "");
    pendiente.mockResolvedValue({ id: "p1", numero: "PED-1", total: 1000, cuotas: 1, pagoMetodo: "mercadopago" });
    const { pedido } = await (await GET()).json();
    expect(pedido.mpPublicKey).toBeUndefined();
    expect(pedido.mpCuenta).toBeUndefined();
  });

  it("sin pendiente: { pedido: null }", async () => {
    pendiente.mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({ pedido: null });
  });
});
