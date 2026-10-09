import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Webhook de Mercado Pago con una cuenta por sucursal: la firma se prueba con el secreto de cada cuenta
 * y la que valida identifica la cuenta; el pago se consulta con SUS credenciales. Firma real
 * (`mercadopago-firma.ts`) y proveedor real; sólo `fetch`, la base y los pedidos son dobles.
 */

const pedidoDelPago = vi.fn();
const registrarCobro = vi.fn();
vi.mock("@/lib/pedidos", () => ({
  pedidoDelPago: (...a: unknown[]) => pedidoDelPago(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
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

import { procesarWebhook } from "./webhook";
import { limpiarMemoCuentas } from "./cuentas-sucursales";

const SECRETOS = { igz: "secreto-de-prueba-igz", mdp: "secreto-de-prueba-mdp" };
const fetchMock = vi.fn();
let error: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

/** Notificación firmada como lo hace Mercado Pago (`id:<data.id>;request-id:<x-request-id>;ts:<ts>;`). */
function aviso(secreto: string, o: { pista?: string; dataId?: string } = {}) {
  const dataId = o.dataId ?? "123";
  const ts = String(Math.floor(Date.now() / 1000));
  const requestId = "req-de-prueba";
  const v1 = createHmac("sha256", secreto).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");
  const pista = o.pista ? `&cuenta=${o.pista}` : "";
  return new Request(`https://tienda.example/api/pagos/mercadopago/webhook?source_news=webhooks${pista}&data.id=${dataId}`, {
    method: "POST",
    headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
    body: JSON.stringify({ data: { id: dataId }, type: "payment" }),
  });
}

const autorizaciones = () =>
  (fetchMock.mock.calls as [string, RequestInit][]).map(([, init]) => (init.headers as Record<string, string>).Authorization);

beforeEach(() => {
  limpiarMemoCuentas();
  vi.stubEnv("MP_WEBHOOK_SECRET_IGZ", SECRETOS.igz);
  vi.stubEnv("MP_WEBHOOK_SECRET_MDP", SECRETOS.mdp);
  vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token-igz");
  vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token-mdp");
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ id: 123, status: "approved", status_detail: "accredited" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  pedidoDelPago.mockResolvedValue({ id: "p1", pagoEstado: "pendiente" });
  registrarCobro.mockResolvedValue(true);
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  pedidoDelPago.mockReset();
  registrarCobro.mockReset();
});

describe("procesarWebhook — cuenta por el secreto que firma", () => {
  it("firma de mdp: se acepta y el pago se consulta con el access token de mdp", async () => {
    const r = await procesarWebhook("mercadopago", aviso(SECRETOS.mdp));
    expect(r.status).toBe(200);
    expect(autorizaciones()).toEqual(["Bearer TEST-token-mdp"]);
    expect(registrarCobro).toHaveBeenCalledWith("p1", expect.objectContaining({ referencia: "123", estado: "pagado" }));
  });

  it("firma de igz: se consulta con igz", async () => {
    expect((await procesarWebhook("mercadopago", aviso(SECRETOS.igz))).status).toBe(200);
    expect(autorizaciones()).toEqual(["Bearer TEST-token-igz"]);
  });

  it("la pista de la URL no es autoridad: pista mdp con firma de igz -> igz (y un aviso en el log)", async () => {
    expect((await procesarWebhook("mercadopago", aviso(SECRETOS.igz, { pista: "mdp" }))).status).toBe(200);
    expect(autorizaciones()).toEqual(["Bearer TEST-token-igz"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cuenta=mdp"));
  });

  it("ningún secreto valida: 401, sin consultar a Mercado Pago y un solo log sin el payload", async () => {
    const r = await procesarWebhook("mercadopago", aviso("secreto-ajeno"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Firma inválida" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registrarCobro).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("2 cuentas");
    expect(JSON.stringify(error.mock.calls)).not.toContain("payment");
  });

  it("ninguna cuenta con secreto: 401 y un log de configuración", async () => {
    vi.stubEnv("MP_WEBHOOK_SECRET_IGZ", "");
    vi.stubEnv("MP_WEBHOOK_SECRET_MDP", "");
    const r = await procesarWebhook("mercadopago", aviso(SECRETOS.igz));
    expect(r.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("secreto del webhook"));
  });

  it("el secreto sin sufijo ya no valida nada", async () => {
    vi.stubEnv("MP_WEBHOOK_SECRET_IGZ", "");
    vi.stubEnv("MP_WEBHOOK_SECRET_MDP", "");
    vi.stubEnv("MP_WEBHOOK_SECRET", SECRETOS.igz);
    expect((await procesarWebhook("mercadopago", aviso(SECRETOS.igz))).status).toBe(401);
  });

  it("un procesador sin webhook (Payway) responde 404", async () => {
    expect((await procesarWebhook("payway", aviso(SECRETOS.igz))).status).toBe(404);
  });
});
