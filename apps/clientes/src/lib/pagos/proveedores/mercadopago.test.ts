import { describe, expect, it, vi } from "vitest";
import fixtureVisa from "./__fixtures__/mp-installments-visa.json";
import {
  crearProveedorMercadoPago,
  normalizarInstallmentsMP,
  parsearLabelsMP,
} from "./mercadopago";

/**
 * Fixture SINTÉTICO con la forma real de GET /v1/payment_methods/installments
 * (array por emisor con payer_costs). Reemplazar por el real de TEST (tarea 0.1)
 * cuando esté: los tests no dependen de los valores exactos más allá de lo
 * comentado.
 */

describe("parsearLabelsMP", () => {
  it("lee CFT y TEA con coma decimal", () => {
    expect(parsearLabelsMP(["CFT_45,67%|TEA_12,34%"])).toEqual({ cftPct: 45.67, teaPct: 12.34 });
  });

  it("ignora otros labels y tolera miles con punto", () => {
    expect(parsearLabelsMP(["recommended_installment", "CFT_1.234,50%|TEA_99,00%"])).toEqual({
      cftPct: 1234.5,
      teaPct: 99,
    });
  });

  it("sin label de costos → null / null", () => {
    expect(parsearLabelsMP(["recommended_installment"])).toEqual({ cftPct: null, teaPct: null });
    expect(parsearLabelsMP(undefined)).toEqual({ cftPct: null, teaPct: null });
  });
});

describe("normalizarInstallmentsMP", () => {
  const planes = normalizarInstallmentsMP("visa", fixtureVisa);
  const por = (c: number) => planes.find((p) => p.cuotas === c);

  it("un plan por cantidad de cuotas, ordenado", () => {
    expect(planes.map((p) => p.cuotas)).toEqual([1, 3, 6, 12]);
    expect(planes.every((p) => p.proveedor === "mercadopago" && p.medio === "visa")).toBe(true);
  });

  it("tasa máxima entre emisores (0% y 18% → 18%) con CFT/TEA de esa misma entrada", () => {
    expect(por(6)).toMatchObject({ tasaPct: 18, cftPct: 45.67, teaPct: 12.34 });
  });

  it("sin interés en todos los emisores → tasa 0", () => {
    expect(por(3)).toMatchObject({ tasaPct: 0, cftPct: 0, teaPct: 0 });
  });

  it("rango más restrictivo: máximo de mínimos y mínimo de máximos", () => {
    expect(por(6)).toMatchObject({ montoMin: 5, montoMax: 50000000 });
    expect(por(1)).toMatchObject({ montoMin: 1, montoMax: 50000000 });
    // 12 cuotas sólo la ofrece un emisor: su rango tal cual.
    expect(por(12)).toMatchObject({ tasaPct: 45.5, montoMin: 6, montoMax: 60000000 });
  });

  it("no expone ningún campo propio de MP", () => {
    const claves = new Set(planes.flatMap((p) => Object.keys(p)));
    expect([...claves].sort()).toEqual(
      ["cftPct", "cuotas", "medio", "montoMax", "montoMin", "proveedor", "tasaPct", "teaPct"].sort(),
    );
  });

  it("entradas mal formadas se ignoran sin tirar", () => {
    const raro = [
      { issuer: {}, payer_costs: [{ installments: "6", installment_rate: 0 }, null] },
      { payer_costs: "nope" },
      null,
      { payer_costs: [{ installments: 3, installment_rate: 10, labels: ["CFT_1,00%|TEA_2,00%"] }] },
    ];
    expect(normalizarInstallmentsMP("master", raro)).toEqual([
      { proveedor: "mercadopago", medio: "master", cuotas: 3, tasaPct: 10, cftPct: 1, teaPct: 2, montoMin: null, montoMax: null },
    ]);
    expect(normalizarInstallmentsMP("master", { error: "x" })).toEqual([]);
  });
});

function respuesta(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("crearProveedorMercadoPago", () => {
  it("consulta /installments por medio con amount y token", async () => {
    const fetchMock = vi.fn(async () => respuesta(200, fixtureVisa));
    const mp = crearProveedorMercadoPago({ fetch: fetchMock, token: "TEST-123" });
    const planes = await mp.obtenerPlanes(["visa"]);

    expect(planes.length).toBe(4);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.mercadopago.com/v1/payment_methods/installments?amount=10000&payment_method_id=visa",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST-123");
  });

  it("error en todos los medios → tira (nunca [])", async () => {
    const mp = crearProveedorMercadoPago({ fetch: async () => respuesta(500, {}), token: "t" });
    await expect(mp.obtenerPlanes(["visa", "master"])).rejects.toThrow(/visa|master/);
  });

  it("timeout en todos los medios → tira", async () => {
    const colgado = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const mp = crearProveedorMercadoPago({ fetch: colgado, token: "t", timeoutMs: 10 });
    await expect(mp.obtenerPlanes(["visa"])).rejects.toThrow();
  });

  it("respuesta 200 sin planes cuenta como fallo (no pisar la última copia buena)", async () => {
    const mp = crearProveedorMercadoPago({ fetch: async () => respuesta(200, []), token: "t" });
    await expect(mp.obtenerPlanes(["visa"])).rejects.toThrow();
  });

  it("sin token → tira", async () => {
    const mp = crearProveedorMercadoPago({ fetch: async () => respuesta(200, fixtureVisa), token: undefined });
    await expect(mp.obtenerPlanes(["visa"])).rejects.toThrow(/MP_ACCESS_TOKEN/);
  });

  it("fallo parcial: informa el medio fallido y devuelve el que anduvo", async () => {
    const mp = crearProveedorMercadoPago({
      fetch: async (url: string) =>
        url.includes("master") ? respuesta(502, {}) : respuesta(200, fixtureVisa),
      token: "t",
    });
    const r = await mp.obtenerPlanesPorMedio(["visa", "master"]);
    expect(r.find((x) => x.medio === "visa")).toMatchObject({ ok: true });
    const master = r.find((x) => x.medio === "master");
    expect(master).toMatchObject({ ok: false });
    expect(master && !master.ok && master.error).toMatch(/502/);

    // obtenerPlanes con fallo parcial no tira: devuelve lo que hay.
    expect((await mp.obtenerPlanes(["visa", "master"])).every((p) => p.medio === "visa")).toBe(true);
  });
});
