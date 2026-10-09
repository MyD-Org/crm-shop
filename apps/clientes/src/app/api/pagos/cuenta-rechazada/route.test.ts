import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El navegador informa que el procesador rechazó la public key de la cuenta del pedido. Sólo se acepta
 * sobre la cuenta vigente del pedido, del dueño y con rate limit; Mercado Pago se corrobora con la key.
 */

const identidadActual = vi.fn();
const getPedidoParaPago = vi.fn();
const permitir = vi.fn(() => true);
const evidencia = vi.hoisted(() => [] as string[]);
const registrarCuentaRechazada = vi.fn(async (_p: string, _proc: string, cuenta: string) => {
  evidencia.push(cuenta);
  return true;
});

vi.mock("@/lib/auth", () => ({ identidadActual: () => identidadActual() }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async (...a: unknown[]) => permitir(...(a as [])) }));
vi.mock("@/lib/pedidos", async (original) => ({
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
  cuentasRechazadasDelPedido: async () => [...evidencia],
  registrarCuentaRechazada: (...a: [string, string, string]) => registrarCuentaRechazada(...a),
}));
vi.mock("@/lib/tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => [
          { slug: "igz", activa: true, predeterminada: true },
          { slug: "mdp", activa: true, predeterminada: false },
        ],
      }),
    }),
  }),
}));

import { POST } from "./route";
import { limpiarMemoCuentas } from "@/lib/pagos/cuentas-sucursales";

const fetchMock = vi.fn();
const pedido = (pagoMetodo = "mercadopago", extra: Record<string, unknown> = {}) => ({
  id: "p1", numero: "PED-1", total: 1000, pagoEstado: "pendiente", pagoMetodo, estado: "pendiente",
  creadoEn: new Date(), sucursal: "mdp", facturaSucursal: null, ...extra,
});
const reportar = (body: Record<string, unknown> = {}) =>
  POST(
    new Request("https://tienda.example/api/pagos/cuenta-rechazada", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", proveedor: "mercadopago", cuenta: "mdp", ...body }),
    }),
  );

beforeEach(() => {
  limpiarMemoCuentas();
  evidencia.length = 0;
  identidadActual.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
  getPedidoParaPago.mockResolvedValue(pedido());
  permitir.mockReturnValue(true);
  vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token-mdp");
  vi.stubEnv("MP_PUBLIC_KEY_MDP", "TEST-publica-mdp");
  vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token-igz");
  vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-publica-igz");
  vi.stubEnv("PAYWAY_BASE_URL", "https://payway.example");
  vi.stubEnv("PAYWAY_API_PRIVATE_KEY_MDP", "privada-mdp");
  vi.stubEnv("PAYWAY_API_PUBLIC_KEY_MDP", "publica-mdp");
  vi.stubEnv("PAYWAY_API_PRIVATE_KEY_IGZ", "privada-igz");
  vi.stubEnv("PAYWAY_API_PUBLIC_KEY_IGZ", "publica-igz");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "invalid public key" }), { status: 401 }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  registrarCuentaRechazada.mockClear();
});

describe("POST /api/pagos/cuenta-rechazada", () => {
  it("Mercado Pago confirma que rechaza la key: evidencia y config de la otra cuenta", async () => {
    const r = await reportar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ cambio: true, config: { cuenta: "igz", publicKey: "TEST-publica-igz" } });
    expect(String(fetchMock.mock.calls[0][0])).toContain("public_key=TEST-publica-mdp");
    expect(registrarCuentaRechazada).toHaveBeenCalledWith("p1", "mercadopago", "mdp", "mdp", "servidor");
  });

  it("Mercado Pago acepta la key: no deja evidencia y sigue la misma cuenta", async () => {
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
    const r = await reportar();
    expect(await r.json()).toEqual({ cambio: false, config: { cuenta: "mdp", publicKey: "TEST-publica-mdp" } });
    expect(registrarCuentaRechazada).not.toHaveBeenCalled();
  });

  it("Mercado Pago no responde: no se da por rechazada", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect((await (await reportar()).json()).cambio).toBe(false);
    expect(registrarCuentaRechazada).not.toHaveBeenCalled();
  });

  it("Payway (sin forma de corroborar): se acepta del dueño, registrada como informada por el cliente", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("payway"));
    const r = await reportar({ proveedor: "payway" });
    expect(await r.json()).toEqual({
      cambio: true,
      config: { cuenta: "igz", publicKey: "publica-igz", baseUrl: "https://payway.example" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registrarCuentaRechazada).toHaveBeenCalledWith("p1", "payway", "mdp", "mdp", "cliente");
  });

  it("una cuenta que no es la vigente del pedido: 409 cuenta_no_valida, sin evidencia", async () => {
    const r = await reportar({ cuenta: "igz" });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.motivo).toBe("cuenta_no_valida");
    expect(j.config).toEqual({ cuenta: "mdp", publicKey: "TEST-publica-mdp" });
    expect(registrarCuentaRechazada).not.toHaveBeenCalled();
  });

  it("sin otra cuenta usable: 502 con el mensaje de inconveniente técnico", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    const r = await reportar();
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/inconveniente técnico/);
  });

  it("pedido ajeno: 404 sin revelar nada", async () => {
    getPedidoParaPago.mockResolvedValue(null);
    const r = await reportar();
    expect(r.status).toBe(404);
    expect(JSON.stringify(await r.json())).not.toContain("publica");
  });

  it("pedido de otro procesador: 404", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("payway"));
    expect((await reportar()).status).toBe(404);
  });

  it("sin sesión: 401; rate limit: 429", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await reportar()).status).toBe(401);
    identidadActual.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    permitir.mockReturnValue(false);
    expect((await reportar()).status).toBe(429);
    expect(registrarCuentaRechazada).not.toHaveBeenCalled();
  });

  it("pedido ya pagado: 409", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("mercadopago", { pagoEstado: "pagado" }));
    expect((await reportar()).status).toBe(409);
  });
});
