import { afterEach, describe, expect, it, vi } from "vitest"
import { AlegraHttpError, AlegraRateLimitError, EVENTOS_STOCK, getItemParaEspejo } from "./alegra"
import type { TenantConfig } from "./tenants"

// Lectura de UN ítem para el espejo (drenador de avisos de stock). A diferencia de
// getItemsLive, tiene que distinguir "no existe" (404 → null) de "Alegra nos frena" (429 →
// AlegraRateLimitError) y de "Alegra falló" (AlegraHttpError). Fetch falso: nada sale a la red.

const tenant = { id: "t", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig

const item = { id: 5, name: "Lámpara de prueba", status: "active", inventory: { availableQuantity: 8 }, price: [] }

function responde(...respuestas: Response[]) {
  const fetchMock = vi.fn(async () => respuestas.shift() ?? new Response("{}", { status: 500 }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("getItemParaEspejo", () => {
  it("200 → el ítem normalizado, pidiendo /items/{id}", async () => {
    const f = responde(new Response(JSON.stringify(item), { status: 200 }))
    const r = await getItemParaEspejo(tenant, "5")
    expect(r?.alegraId).toBe("5")
    expect(r?.stock).toBe(8)
    expect(new URL(String((f.mock.calls[0] as unknown[])[0])).pathname).toMatch(/\/items\/5$/)
  })

  it("404 → null", async () => {
    responde(new Response('{"message":"no existe"}', { status: 404 }))
    expect(await getItemParaEspejo(tenant, "5")).toBeNull()
  })

  it("429 agotado → AlegraRateLimitError, y onRequest cuenta cada request", async () => {
    responde(new Response("", { status: 429 }))
    const onRequest = vi.fn()
    await expect(getItemParaEspejo(tenant, "5", { reintentos429: 0, onRequest })).rejects.toBeInstanceOf(AlegraRateLimitError)
    expect(onRequest).toHaveBeenCalledTimes(1)
  })

  it("429 y después 200 con un reintento: dos requests", async () => {
    vi.useFakeTimers()
    responde(new Response("", { status: 429, headers: { "retry-after": "1" } }), new Response(JSON.stringify(item), { status: 200 }))
    const onRequest = vi.fn()
    const p = getItemParaEspejo(tenant, "5", { reintentos429: 1, onRequest })
    await vi.advanceTimersByTimeAsync(2000)
    expect((await p)?.alegraId).toBe("5")
    expect(onRequest).toHaveBeenCalledTimes(2)
  })

  it("500 → AlegraHttpError con el status", async () => {
    responde(new Response("caído", { status: 500 }))
    const err = await getItemParaEspejo(tenant, "5").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AlegraHttpError)
    expect((err as AlegraHttpError).status).toBe(500)
  })

  it("modo mock: usa los fixtures, sin red", async () => {
    const f = responde()
    const mock = { ...tenant, alegraMock: true } as TenantConfig
    expect(await getItemParaEspejo(mock, "no-existe")).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

describe("EVENTOS_STOCK", () => {
  it("son los 9 eventos de facturas, compras e ítems", () => {
    expect([...EVENTOS_STOCK].sort()).toEqual(
      [
        "new-invoice",
        "edit-invoice",
        "delete-invoice",
        "new-bill",
        "edit-bill",
        "delete-bill",
        "new-item",
        "edit-item",
        "delete-item",
      ].sort(),
    )
  })
})

describe("mapRawItem (vía getItemParaEspejo): code e impuestos", () => {
  async function mapear(extra: Record<string, unknown>) {
    responde(new Response(JSON.stringify({ ...item, ...extra }), { status: 200 }))
    return getItemParaEspejo(tenant, "5")
  }

  it.each([
    ["string", "ABC", "ABC"],
    ["objeto con reference", { reference: "ABC" }, "ABC"],
    ["objeto con reference null", { reference: null }, null],
    ["string vacío", "", null],
    ["ausente", undefined, null],
  ])("code: %s", async (_caso, reference, esperado) => {
    expect((await mapear({ reference }))?.code).toBe(esperado)
  })

  it("IVA: dos impuestos se suman", async () => {
    expect((await mapear({ tax: [{ percentage: 21 }, { percentage: 3 }] }))?.ivaPorcentaje).toBe(24)
  })

  it("IVA: sin tax → null", async () => {
    expect((await mapear({}))?.ivaPorcentaje).toBeNull()
  })
})
