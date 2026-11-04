import { describe, expect, it, vi } from "vitest";
import type { PlanMP, PlanesMP } from "./mercadopago-planes";

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

const { consultarCuotasSinInteres, maxCuotasSinInteresComun } = await import("./cuotas-sin-interes-mp");

const plan = (cuotas: number, sinInteres: boolean): PlanMP => ({
  cuotas,
  montoCuota: 100,
  total: 100 * cuotas,
  tasaPct: sinInteres ? 0 : 20,
  cft: sinInteres ? null : "10,00",
  tea: sinInteres ? null : "10,00",
  conInteres: !sinInteres,
});
const emisor = (...planes: PlanMP[]): PlanesMP => ({ metodoPagoId: "visa", emisor: null, logo: null, planes });

describe("maxCuotasSinInteresComun", () => {
  it("la mayor cantidad sin interés que dan todos los emisores con cuotas", () => {
    expect(
      maxCuotasSinInteresComun([
        emisor(plan(3, true), plan(6, true), plan(12, false)),
        emisor(plan(3, true), plan(6, true), plan(9, true)),
      ]),
    ).toBe(6);
  });

  it("si un emisor no da una cantidad sin interés, esa no se anuncia", () => {
    expect(maxCuotasSinInteresComun([emisor(plan(3, true), plan(6, true)), emisor(plan(3, true), plan(6, false))])).toBe(3);
  });

  it("los emisores que sólo dan 1 pago (sin planes de 2 o más) no cuentan", () => {
    expect(maxCuotasSinInteresComun([emisor(plan(3, true)), emisor()])).toBe(3);
  });

  it("todas con interés, sin emisores o sin una cantidad común: null", () => {
    expect(maxCuotasSinInteresComun([emisor(plan(3, false), plan(6, false))])).toBeNull();
    expect(maxCuotasSinInteresComun([])).toBeNull();
    expect(maxCuotasSinInteresComun([emisor(plan(3, true)), emisor(plan(6, true))])).toBeNull();
  });
});

const respuesta = (planes: [number, number][]) => [
  {
    payment_method_id: "visa",
    payment_type_id: "credit_card",
    issuer: { id: 1, name: "Banco" },
    payer_costs: planes.map(([n, tasa]) => ({
      installments: n,
      installment_rate: tasa,
      installment_amount: 1000 / n,
      total_amount: 1000,
      labels: tasa === 0 ? [] : ["CFT_10,00%|TEA_10,00%"],
    })),
  },
];
const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });

describe("consultarCuotasSinInteres", () => {
  it("consulta visa y master con el token y combina los emisores", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok(respuesta([[1, 0], [3, 0], [6, 0]])))
      .mockResolvedValueOnce(ok(respuesta([[1, 0], [3, 0], [6, 15]])));
    expect(await consultarCuotasSinInteres("tok", { fetch })).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toContain("payment_method_id=visa");
    expect(String(fetch.mock.calls[1][0])).toContain("payment_method_id=master");
    expect(fetch.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("si MP responde error, lanza (quien llama no anuncia nada)", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(consultarCuotasSinInteres("tok", { fetch })).rejects.toThrow("HTTP 500");
  });
});
