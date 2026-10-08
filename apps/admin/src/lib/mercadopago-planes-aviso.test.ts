import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clavesPublicasMP,
  consultarInteresDeReferencia,
  consultarCuotasConInteres,
  parsearCuotasConInteres,
  vaciarCacheDeInteresMP,
} from "@/lib/mercadopago-planes-aviso"

// Forma de la respuesta de GET /v1/payment_methods/installments (public key de ejemplo, sin datos reales).
const plan = (installments: number, installment_rate: number) => ({ installments, installment_rate, total_amount: 1000 })
const respuesta = (...costos: ReturnType<typeof plan>[]) => [
  { payment_method_id: "visa", payment_type_id: "credit_card", issuer: { id: "1" }, payer_costs: costos },
]
const ok = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { "content-type": "application/json" } })

describe("clavesPublicasMP", () => {
  it("lee MP_PUBLIC_KEY y la devuelve como la cuenta principal", () => {
    expect(clavesPublicasMP({ MP_PUBLIC_KEY: " APP_USR-clave-ejemplo " })).toEqual([
      { cuentaId: "principal", publicKey: "APP_USR-clave-ejemplo" },
    ])
  })
  it("sin clave (ausente o vacía) no hay cuentas", () => {
    expect(clavesPublicasMP({})).toEqual([])
    expect(clavesPublicasMP({ MP_PUBLIC_KEY: "  " })).toEqual([])
  })
})

describe("parsearCuotasConInteres", () => {
  it("devuelve las cantidades con installment_rate > 0", () => {
    const r = parsearCuotasConInteres(respuesta(plan(1, 0), plan(3, 0), plan(6, 32.5), plan(12, 60)))
    expect([...(r ?? [])].sort((a, b) => a - b)).toEqual([6, 12])
  })
  it("tasa 0 en todo: conjunto vacío (distinto de ilegible)", () => {
    expect(parsearCuotasConInteres(respuesta(plan(3, 0), plan(6, 0)))).toEqual(new Set())
  })
  it("acepta la tasa como texto", () => {
    expect(parsearCuotasConInteres(respuesta({ installments: 6, installment_rate: "12.5" } as never))).toEqual(new Set([6]))
  })
  it("si algún emisor cobra interés en esa cantidad, cuenta", () => {
    const json = [
      { payment_type_id: "credit_card", payer_costs: [plan(6, 0)] },
      { payment_type_id: "credit_card", payer_costs: [plan(6, 20)] },
    ]
    expect(parsearCuotasConInteres(json)).toEqual(new Set([6]))
  })
  it("ignora débito y los pagos de 1 cuota", () => {
    const json = [{ payment_type_id: "debit_card", payer_costs: [plan(6, 30)] }, ...respuesta(plan(1, 5))]
    expect(parsearCuotasConInteres(json)).toEqual(new Set())
  })
  it.each([null, undefined, "x", 3, {}, { message: "invalid public_key", status: 400 }, [{ payer_costs: "no" }]])(
    "JSON ilegible (%j) => null",
    (json) => {
      expect(parsearCuotasConInteres(json)).toBeNull()
    },
  )
})

describe("consultarCuotasConInteres", () => {
  beforeEach(() => vaciarCacheDeInteresMP())
  afterEach(() => vi.unstubAllGlobals())

  it("pide a MP con la clave pública, la marca y el monto", async () => {
    const f = vi.fn().mockResolvedValue(ok(respuesta(plan(6, 30))))
    vi.stubGlobal("fetch", f)
    const r = await consultarCuotasConInteres({ publicKey: "APP_USR-clave-ejemplo", paymentMethodId: "naranja", amount: 100000 })
    expect(r).toEqual(new Set([6]))
    const url = new URL(String(f.mock.calls[0][0]))
    expect(url.origin + url.pathname).toBe("https://api.mercadopago.com/v1/payment_methods/installments")
    expect(url.searchParams.get("public_key")).toBe("APP_USR-clave-ejemplo")
    expect(url.searchParams.get("payment_method_id")).toBe("naranja")
    expect(url.searchParams.get("amount")).toBe("100000")
  })

  it("cachea el resultado un rato", async () => {
    const f = vi.fn().mockImplementation(async () => ok(respuesta(plan(6, 30))))
    vi.stubGlobal("fetch", f)
    const args = { publicKey: "k", paymentMethodId: "visa", amount: 100000 }
    await consultarCuotasConInteres(args)
    await consultarCuotasConInteres(args)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("no cachea los fallos", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("", { status: 500 })).mockResolvedValueOnce(ok(respuesta(plan(6, 30))))
    vi.stubGlobal("fetch", f)
    const args = { publicKey: "k", paymentMethodId: "visa", amount: 100000 }
    expect(await consultarCuotasConInteres(args)).toBeNull()
    expect(await consultarCuotasConInteres(args)).toEqual(new Set([6]))
  })

  it.each([
    ["5xx", () => Promise.resolve(new Response("", { status: 503 }))],
    ["400 con mensaje", () => Promise.resolve(new Response('{"message":"invalid public_key"}', { status: 400 }))],
    ["JSON ilegible", () => Promise.resolve(new Response("<html>", { status: 200 }))],
    ["red caída", () => Promise.reject(new TypeError("fetch failed"))],
    ["timeout", () => Promise.reject(new DOMException("timeout", "TimeoutError"))],
  ])("%s => null sin lanzar", async (_n, impl) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(impl))
    await expect(consultarCuotasConInteres({ publicKey: "k", paymentMethodId: "visa", amount: 1 })).resolves.toBeNull()
  })
})

describe("consultarInteresDeReferencia", () => {
  beforeEach(() => vaciarCacheDeInteresMP())
  afterEach(() => vi.unstubAllGlobals())

  it("consulta las cinco marcas principales y descarta las que no respondieron", async () => {
    const f = vi.fn().mockImplementation(async (u: string) => {
      const marca = new URL(u).searchParams.get("payment_method_id")
      if (marca === "cabal") return new Response("", { status: 500 })
      return ok(respuesta(plan(3, 0), plan(6, marca === "naranja" ? 40 : 0)))
    })
    vi.stubGlobal("fetch", f)
    const r = await consultarInteresDeReferencia(100000, [{ cuentaId: "principal", publicKey: "k" }])
    expect(f).toHaveBeenCalledTimes(5)
    expect(r).toHaveLength(1)
    expect(r[0].marcas.map((m) => m.nombre)).toEqual(["Visa", "Mastercard", "American Express", "Naranja"])
    expect(r[0].marcas.find((m) => m.nombre === "Naranja")?.cuotasConInteres).toEqual(new Set([6]))
  })

  it("sin claves no llama a MP", async () => {
    const f = vi.fn()
    vi.stubGlobal("fetch", f)
    expect(await consultarInteresDeReferencia(100000, [])).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })
})
