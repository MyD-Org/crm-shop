import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reconciliar = vi.fn();
vi.mock("@/lib/pagos/reconciliar", () => ({ reconciliarPagosPendientes: () => reconciliar() }));
const avisarPagoPendiente = vi.fn();
const pedidosConAvisoPagoPendiente = vi.fn();
vi.mock("@/lib/pedido-avisos", () => ({
  avisarPagoPendiente: (id: string) => avisarPagoPendiente(id),
  pedidosConAvisoPagoPendiente: () => pedidosConAvisoPagoPendiente(),
  avisarPedidoSiFalta: vi.fn(),
  pedidosConAvisosPendientes: async () => [],
}));

import { GET } from "./route";

const pedir = (auth?: string) =>
  GET(new Request("https://tienda.example/api/cron/pagos-reconciliar", auth ? { headers: { authorization: auth } } : {}));

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "secreto-de-prueba");
  reconciliar.mockReset().mockResolvedValue({ revisados: 0, actualizados: 0, errores: 0 });
  avisarPagoPendiente.mockReset();
  pedidosConAvisoPagoPendiente.mockReset().mockResolvedValue([]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/pagos-reconciliar: aviso de pago pendiente", () => {
  it("sin el secreto, 401 y no avisa nada", async () => {
    expect((await pedir()).status).toBe(401);
    expect(pedidosConAvisoPagoPendiente).not.toHaveBeenCalled();
  });

  it("avisa a cada pedido pendiente y cuenta sólo los que le tocaron", async () => {
    pedidosConAvisoPagoPendiente.mockResolvedValue(["a", "b", "c"]);
    avisarPagoPendiente.mockImplementation(async (id: string) => id !== "b");
    const body = await (await pedir("Bearer secreto-de-prueba")).json();
    expect(avisarPagoPendiente).toHaveBeenCalledTimes(3);
    expect(body.avisadosPagoPendiente).toBe(2);
  });

  it("si buscar los pendientes falla, el cron responde 200 igual", async () => {
    pedidosConAvisoPagoPendiente.mockRejectedValue(new Error("base"));
    const r = await pedir("Bearer secreto-de-prueba");
    expect(r.status).toBe(200);
    expect((await r.json()).avisadosPagoPendiente).toBe(0);
  });
});
