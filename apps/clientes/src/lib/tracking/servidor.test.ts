import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { cuerpoPedidoConfirmado, medirPedidoConfirmadoInvitado, uuidDeMedicion } from "./servidor";

const PEDIDO = "33333333-3333-4333-8333-333333333333";
const medicion = { pedidoId: PEDIDO, total: 12345.678, medio: "mercadopago" };

beforeEach(() => {
  vi.stubEnv("POSTHOG_KEY", "phc_clavedepruebaservidor");
  vi.stubEnv("POSTHOG_REGION", "us");
  setFlag("tracking", true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cuerpoPedidoConfirmado", () => {
  const cuerpo = cuerpoPedidoConfirmado(medicion, "phc_x", new Date("2026-01-01T00:00:00Z"));

  it("lleva sólo id del pedido, total y medio (sin PII ni token)", () => {
    expect(cuerpo.event).toBe("pedido_confirmado");
    expect(cuerpo.properties).toEqual({
      pedido_id: PEDIDO,
      valor: 12345.68,
      moneda: "ARS",
      medio_pago: "mercadopago",
      compra_invitado: true,
      origen: "servidor",
      $process_person_profile: false,
    });
    const texto = JSON.stringify(cuerpo);
    expect(texto).not.toMatch(/email|telefono|documento|dni|cuit|token|@/i);
  });

  it("el uuid es el mismo para el mismo pedido (PostHog descarta el repetido) y distinto entre pedidos", () => {
    expect(uuidDeMedicion(PEDIDO)).toBe(uuidDeMedicion(PEDIDO));
    expect(uuidDeMedicion(PEDIDO)).not.toBe(uuidDeMedicion("44444444-4444-4444-8444-444444444444"));
    expect(uuidDeMedicion(PEDIDO)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(cuerpo.uuid).toBe(uuidDeMedicion(PEDIDO));
  });
});

describe("medirPedidoConfirmadoInvitado", () => {
  it("con el flag prendido y la key, manda un POST a la ingesta de la región", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}"));
    await medirPedidoConfirmadoInvitado(medicion, f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("https://us.i.posthog.com/capture/");
    const cuerpo = JSON.parse(f.mock.calls[0][1].body);
    expect(cuerpo.api_key).toBe("phc_clavedepruebaservidor");
    expect(cuerpo.properties.pedido_id).toBe(PEDIDO);
  });

  it("flag tracking apagado => no manda nada", async () => {
    setFlag("tracking", false);
    const f = vi.fn();
    await medirPedidoConfirmadoInvitado(medicion, f);
    expect(f).not.toHaveBeenCalled();
  });

  it("sin POSTHOG_KEY => no manda nada", async () => {
    vi.stubEnv("POSTHOG_KEY", "");
    const f = vi.fn();
    await medirPedidoConfirmadoInvitado(medicion, f);
    expect(f).not.toHaveBeenCalled();
  });

  it("nunca lanza: la red caída sólo deja el id del pedido en el log", async () => {
    const f = vi.fn().mockRejectedValue(new Error("boom con datos@cliente.example"));
    await expect(medirPedidoConfirmadoInvitado(medicion, f)).resolves.toBeUndefined();
    const logs = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logs).toContain(PEDIDO);
    expect(logs).not.toContain("cliente.example");
  });
});
