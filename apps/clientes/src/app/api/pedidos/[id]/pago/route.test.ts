import { beforeEach, describe, expect, it, vi } from "vitest";

const identidad = vi.fn();
const estadoPago = vi.fn();
const permitir = vi.fn();

vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/pagos/estado-pago-pedido", () => ({ estadoPagoDelPedido: (...a: unknown[]) => estadoPago(...a) }));
vi.mock("@/lib/rate-limit", () => ({ permitir: (...a: unknown[]) => permitir(...a) }));

import { GET } from "./route";

const ctx = (id = "p1") => ({ params: Promise.resolve({ id }) });
const req = new Request("http://localhost/api/pedidos/p1/pago");

beforeEach(() => {
  vi.clearAllMocks();
  identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
  permitir.mockReturnValue(true);
  estadoPago.mockResolvedValue({ estado: "pendiente", enLinea: true, cobrable: true });
});

describe("GET /api/pedidos/[id]/pago", () => {
  it("sin sesión: 401 y no consulta nada", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await GET(req, ctx())).status).toBe(401);
    expect(estadoPago).not.toHaveBeenCalled();
  });

  it("rate limit: 429 sin consultar al procesador", async () => {
    permitir.mockReturnValue(false);
    expect((await GET(req, ctx())).status).toBe(429);
    expect(estadoPago).not.toHaveBeenCalled();
  });

  it("pedido ajeno o inexistente: 404", async () => {
    estadoPago.mockResolvedValue(null);
    expect((await GET(req, ctx())).status).toBe(404);
  });

  it("filtra por el dueño de la sesión y devuelve el estado sin cache", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "C1" } });
    const r = await GET(req, ctx("p9"));
    expect(estadoPago).toHaveBeenCalledWith("p9", { clerkUserId: "user_1", clienteCodigo: "C1" }, {});
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ estado: "pendiente", enLinea: true, cobrable: true });
  });

  it("con ?pago_mp (vuelta de Mercado Pago) pasa ese id; uno que no es numérico se ignora", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    await GET(new Request("http://localhost/api/pedidos/p9/pago?pago_mp=123456"), ctx("p9"));
    expect(estadoPago).toHaveBeenLastCalledWith("p9", { clerkUserId: "user_1", clienteCodigo: undefined }, { pagoMercadoPagoId: "123456" });
    await GET(new Request("http://localhost/api/pedidos/p9/pago?pago_mp=null"), ctx("p9"));
    expect(estadoPago).toHaveBeenLastCalledWith("p9", { clerkUserId: "user_1", clienteCodigo: undefined }, {});
  });
});
