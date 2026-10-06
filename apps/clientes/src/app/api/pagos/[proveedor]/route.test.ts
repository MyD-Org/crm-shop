import { beforeEach, describe, expect, it, vi } from "vitest";

/** Rutas genéricas de cobro y de webhook por procesador (rebanada A de payway-cobro). */

const cobrarPedido = vi.fn();
const procesarWebhook = vi.fn();
const sinWebhook = { id: "sinwebhook", configurado: () => true };
const conWebhook = { id: "conwebhook", configurado: () => true, verificarWebhook: async () => ({ valido: true }) };

vi.mock("@/lib/pagos/cobrar", () => ({ cobrarPedido: (...a: unknown[]) => cobrarPedido(...a) }));
vi.mock("@/lib/pagos/webhook", () => ({ procesarWebhook: (...a: unknown[]) => procesarWebhook(...a) }));
vi.mock("@/lib/pagos", () => ({
  proveedorPago: (id: string) => ({ sinwebhook: sinWebhook, conwebhook: conWebhook })[id] ?? null,
}));

import { POST as cobrar, maxDuration } from "./route";
import { POST as webhook } from "./webhook/route";

const req = (ruta: string) => new Request(`https://tienda.example${ruta}`, { method: "POST", body: "{}" });
const ctx = (proveedor: string) => ({ params: Promise.resolve({ proveedor }) });

beforeEach(() => {
  cobrarPedido.mockReset();
  procesarWebhook.mockReset();
  cobrarPedido.mockResolvedValue(new Response("cobro"));
  procesarWebhook.mockResolvedValue(new Response("hook"));
});

describe("POST /api/pagos/[proveedor]", () => {
  it("la función dura lo que el peor caso de Payway (POST 30 s + 3 consultas)", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(90);
  });

  it("delega en cobrarPedido con el proveedor de la URL", async () => {
    const r = await cobrar(req("/api/pagos/conwebhook"), ctx("conwebhook"));
    expect(await r.text()).toBe("cobro");
    expect(cobrarPedido).toHaveBeenCalledWith(conWebhook, expect.any(Request));
  });

  it("procesador desconocido → 404 en usted, sin cobrar", async () => {
    const r = await cobrar(req("/api/pagos/otro"), ctx("otro"));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Ese medio de pago no está disponible." });
    expect(cobrarPedido).not.toHaveBeenCalled();
  });
});

describe("POST /api/pagos/[proveedor]/webhook", () => {
  it("delega en procesarWebhook cuando el proveedor sabe verificar", async () => {
    const r = await webhook(req("/api/pagos/conwebhook/webhook"), ctx("conwebhook"));
    expect(await r.text()).toBe("hook");
    expect(procesarWebhook).toHaveBeenCalledWith(conWebhook, expect.any(Request));
  });

  it("proveedor sin verificarWebhook (se concilia por cron) → 404", async () => {
    const r = await webhook(req("/api/pagos/sinwebhook/webhook"), ctx("sinwebhook"));
    expect(r.status).toBe(404);
    expect(procesarWebhook).not.toHaveBeenCalled();
  });

  it("proveedor desconocido → 404", async () => {
    expect((await webhook(req("/api/pagos/otro/webhook"), ctx("otro"))).status).toBe(404);
  });
});
