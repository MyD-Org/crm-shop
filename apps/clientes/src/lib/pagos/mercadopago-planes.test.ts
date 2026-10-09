import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import binVisa from "./__fixtures__/mercadopago/installments-bin-visa.json";
import binMaster from "./__fixtures__/mercadopago/installments-bin-master.json";
import referenciaVisa from "./__fixtures__/mercadopago/installments-visa.json";
import debitoVisa from "./__fixtures__/mercadopago/installments-debvisa.json";
import {
  consultarPlanesMP,
  limpiarCachePlanesMP,
  parsearCftTea,
  parsearPlanesMP,
  planesDeReferencia,
} from "./mercadopago-planes";

/**
 * Fixtures: respuestas REALES de `GET /v1/payment_methods/installments` (cuenta de PRUEBA, monto
 * $50.000, 2026-10-08), sanitizadas (sin `payment_method_option_id`). La cuenta de prueba tiene TODAS
 * las cuotas con interés. Con BIN responde una entrada (el emisor de esa tarjeta); con
 * `payment_method_id` responde una por emisor (81 para visa; el fixture conserva 3 representativas).
 */

describe("parsearCftTea (formato real de `labels`)", () => {
  it("lee CFT y TEA con coma decimal", () => {
    expect(parsearCftTea(["CFT_249,00%|TEA_184,00%"])).toEqual({ cft: "249,00", tea: "184,00" });
  });
  it("ignora otras etiquetas y toma la de CFT/TEA", () => {
    expect(parsearCftTea(["recommended_installment", "CFT_0,00%|TEA_0,00%"])).toEqual({ cft: "0,00", tea: "0,00" });
  });
  it.each([[undefined], [[]], [["CFT_249,00%"]], [["TEA_1%|CFT_2%"]], [[42]], ["CFT_1%|TEA_2%"]])(
    "sin las dos cifras parseables (%j): null",
    (labels) => {
      expect(parsearCftTea(labels)).toBeNull();
    },
  );
});

describe("parsearPlanesMP", () => {
  it("BIN de Visa: una entrada de crédito con las cuotas >= 2, con interés y CFT/TEA", () => {
    const [visa, ...resto] = parsearPlanesMP(binVisa);
    expect(resto).toEqual([]);
    expect(visa.metodoPagoId).toBe("visa");
    expect(visa.emisor).toEqual({ id: "310", nombre: "Banco Santander" });
    expect(visa.logo).toMatch(/^https:\/\//);
    expect(visa.planes.map((p) => p.cuotas)).toEqual([2, 3, 6, 9, 12, 18, 24]);
    expect(visa.planes.find((p) => p.cuotas === 6)).toEqual({
      cuotas: 6,
      montoCuota: 11011.67,
      total: 66070,
      tasaPct: 32.14,
      cft: "169,00",
      tea: "130,00",
      conInteres: true,
    });
  });

  it("descarta el pago único (lo ofrece la tienda, no Mercado Pago)", () => {
    for (const e of parsearPlanesMP(binMaster)) expect(e.planes.some((p) => p.cuotas < 2)).toBe(false);
  });

  it("débito: no hay planes en cuotas (las entradas de débito no se devuelven)", () => {
    expect(parsearPlanesMP(debitoVisa)).toEqual([]);
  });

  it("con interés SIN CFT/TEA parseables no se ofrece", () => {
    const json = structuredClone(binVisa) as typeof binVisa;
    json[0].payer_costs[3].labels = ["algo-raro"];
    const planes = parsearPlanesMP(json)[0].planes;
    expect(planes.some((p) => p.cuotas === 6)).toBe(false);
    expect(planes.some((p) => p.cuotas === 3)).toBe(true);
  });

  it("tasa 0 en N >= 2: sin interés a cargo del vendedor, se ofrece aunque no traiga CFT/TEA", () => {
    const json = structuredClone(binVisa) as typeof binVisa;
    Object.assign(json[0].payer_costs[2], { installment_rate: 0, total_amount: 50000, installment_amount: 16666.67, labels: [] });
    expect(parsearPlanesMP(json)[0].planes.find((p) => p.cuotas === 3)).toEqual({
      cuotas: 3,
      montoCuota: 16666.67,
      total: 50000,
      tasaPct: 0,
      cft: null,
      tea: null,
      conInteres: false,
    });
  });

  it("prepagas y tipos que no son crédito no se devuelven", () => {
    const json = structuredClone(binVisa) as typeof binVisa;
    json[0].payment_type_id = "prepaid_card";
    expect(parsearPlanesMP(json)).toEqual([]);
  });

  it.each([null, undefined, "x", {}, [null], [{ payment_type_id: "credit_card" }], [{ payment_type_id: "credit_card", payer_costs: "x" }]])(
    "basura (%j): sin excepción",
    (json) => {
      expect(() => parsearPlanesMP(json)).not.toThrow();
      expect(parsearPlanesMP(json).every((e) => e.planes.length === 0)).toBe(true);
    },
  );

  it("planes con números inválidos se descartan uno a uno", () => {
    const json = structuredClone(binVisa) as unknown as { payer_costs: Record<string, unknown>[] }[];
    json[0].payer_costs[1].installments = 2.5;
    json[0].payer_costs[2].total_amount = "59845";
    expect(parsearPlanesMP(json)[0].planes.map((p) => p.cuotas)).toEqual([6, 9, 12, 18, 24]);
  });
});

describe("planesDeReferencia (sin BIN: una entrada por emisor)", () => {
  it("elige la entrada con más cuotas", () => {
    const ref = planesDeReferencia(parsearPlanesMP(referenciaVisa));
    expect(ref?.planes.map((p) => p.cuotas)).toEqual([2, 3, 6, 9, 12, 18, 24]);
  });
  it("sin entradas: null", () => {
    expect(planesDeReferencia([])).toBeNull();
  });
});

describe("consultarPlanesMP", () => {
  const respuesta = (cuerpo: unknown, status = 200) =>
    new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status });
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    limpiarCachePlanesMP();
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token-de-prueba");
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token-otra-cuenta");
    fetchMock = vi.fn<typeof fetch>(async () => respuesta(binVisa));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("consulta con el access token y el BIN, y devuelve los planes de esa tarjeta", async () => {
    const r = await consultarPlanesMP({ cuenta: "mdp", amount: 50000, bin: "45099512" }, { fetch: fetchMock });
    expect(r).toMatchObject({ ok: true, entrada: { metodoPagoId: "visa" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/v1/payment_methods/installments?amount=50000&bin=45099512");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST-token-de-prueba");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sin BIN, por método de pago (referencia): la entrada con más cuotas", async () => {
    fetchMock.mockResolvedValue(respuesta(referenciaVisa));
    const r = await consultarPlanesMP({ cuenta: "mdp", amount: 50000, paymentMethodId: "visa" }, { fetch: fetchMock });
    expect(fetchMock.mock.calls[0][0]).toContain("payment_method_id=visa");
    expect(r.ok && r.entrada?.planes.length).toBe(7);
  });

  it("MP respondió sin planes de crédito (débito): ok con entrada null", async () => {
    fetchMock.mockResolvedValue(respuesta(debitoVisa));
    expect(await consultarPlanesMP({ cuenta: "mdp", amount: 50000, bin: "40000000" }, { fetch: fetchMock })).toEqual({
      ok: true,
      entrada: null,
    });
  });

  it.each([
    ["5xx", () => respuesta({ message: "error" }, 502)],
    ["4xx", () => respuesta({ message: "bad request" }, 400)],
    ["JSON ilegible", () => respuesta("<html>")],
  ])("%s: { ok: false } sin lanzar", async (_n, crear) => {
    fetchMock.mockResolvedValue(crear());
    expect(await consultarPlanesMP({ cuenta: "mdp", amount: 50000, bin: "450995" }, { fetch: fetchMock })).toEqual({ ok: false });
  });

  it("timeout / red caída: { ok: false } sin lanzar", async () => {
    fetchMock.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    expect(await consultarPlanesMP({ cuenta: "mdp", amount: 50000, bin: "450995" }, { fetch: fetchMock })).toEqual({ ok: false });
  });

  it("el timeout es de 3 s", async () => {
    const espia = vi.spyOn(AbortSignal, "timeout");
    await consultarPlanesMP({ cuenta: "mdp", amount: 50000, bin: "450995" }, { fetch: fetchMock });
    expect(espia).toHaveBeenCalledWith(3_000);
    espia.mockRestore();
  });

  it("sin access token no llama a MP: { ok: false }", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "");
    expect(await consultarPlanesMP({ cuenta: "mdp", amount: 50000, bin: "450995" }, { fetch: fetchMock })).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ amount: 0, bin: "450995" }],
    [{ amount: Number.NaN, bin: "450995" }],
    [{ amount: 50000, bin: "4509" }],
    [{ amount: 50000, bin: "450995&x=1" }],
    [{ amount: 50000 }],
    [{ amount: 50000, paymentMethodId: "visa&x" }],
  ])("entrada inválida %j: { ok: false } sin llamar", async (q) => {
    expect(await consultarPlanesMP({ cuenta: "mdp", ...q }, { fetch: fetchMock })).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("con el access token de la cuenta pedida; las variables sin sufijo no sirven", async () => {
    await consultarPlanesMP({ cuenta: "igz", amount: 50000, bin: "450995" }, { fetch: fetchMock });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST-token-otra-cuenta");
    vi.stubEnv("MP_ACCESS_TOKEN", "TEST-token-viejo");
    expect(await consultarPlanesMP({ cuenta: "otra", amount: 50000, bin: "450995" }, { fetch: fetchMock })).toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("la caché es por cuenta: la misma tarjeta en otra cuenta vuelve a consultar", async () => {
    await consultarPlanesMP({ cuenta: "mdp", amount: 50000, bin: "450995" }, { fetch: fetchMock });
    await consultarPlanesMP({ cuenta: "igz", amount: 50000, bin: "450995" }, { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caché de 60 s por (cuenta, monto, BIN); los errores no se cachean", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await consultarPlanesMP({ cuenta: "mdp", amount: 50000, bin: "450995" }, { fetch: fetchMock });
    await consultarPlanesMP({ cuenta: "mdp", amount: 50000, bin: "450995" }, { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await consultarPlanesMP({ cuenta: "mdp", amount: 60000, bin: "450995" }, { fetch: fetchMock });
    await consultarPlanesMP({ cuenta: "mdp", amount: 50000, bin: "503175" }, { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(60_001);
    await consultarPlanesMP({ cuenta: "mdp", amount: 50000, bin: "450995" }, { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    fetchMock.mockResolvedValue(respuesta({}, 500));
    await consultarPlanesMP({ cuenta: "mdp", amount: 70000, bin: "450995" }, { fetch: fetchMock });
    fetchMock.mockResolvedValue(respuesta(binVisa));
    const r = await consultarPlanesMP({ cuenta: "mdp", amount: 70000, bin: "450995" }, { fetch: fetchMock });
    expect(r.ok).toBe(true);
  });
});
