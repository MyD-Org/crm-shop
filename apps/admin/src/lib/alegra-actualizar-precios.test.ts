import { afterEach, describe, expect, it, vi } from "vitest"
import {
  actualizarPreciosItem,
  AlegraHttpError,
  AlegraPrecioNoPersistioError,
  AlegraRateLimitError,
  getItemParaPrecios,
} from "./alegra"
import { __mockPutsRecibidos, __resetMockPut, __setMockPutModo } from "./mock-alegra"
import type { TenantConfig } from "./tenants"

// getItemParaPrecios / actualizarPreciosItem: fetch falso (real) y mock (alegraMock). Datos inventados.

const real = { id: "t1", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig
const mock = { id: "t1", alegraMock: true, alegraEmail: "", alegraToken: "" } as unknown as TenantConfig

function responde(...respuestas: Response[]) {
  const fetchMock = vi.fn(async () => respuestas.shift() ?? new Response("{}", { status: 500 }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}
const llamada = (f: ReturnType<typeof responde>, i: number) => {
  const [url, init] = f.mock.calls[i] as unknown as [string, RequestInit]
  return { url: new URL(url), method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined }
}

const ITEM = {
  id: 55,
  name: "Producto de prueba",
  reference: "PP-1",
  status: "active",
  price: [
    { idPriceList: 1, name: "General", price: 100 },
    { idPriceList: 5, name: "Mayorista", price: 80 },
  ],
  inventory: { unit: "unit", unitCost: 60.5, availableQuantity: 3 },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  __resetMockPut()
})

describe("getItemParaPrecios", () => {
  it("devuelve precios (con su tipo de id), unidad y costo; pide fields=inventory", async () => {
    const f = responde(Response.json(ITEM))
    const r = await getItemParaPrecios(real, "55")
    expect(r).toMatchObject({ unit: "unit", unitCost: 60.5, tipo: "simple", status: "active" })
    expect(r?.price).toEqual([
      { idPriceList: 1, price: 100 },
      { idPriceList: 5, price: 80 },
    ])
    expect(llamada(f, 0).url.pathname).toMatch(/\/items\/55$/)
    expect(llamada(f, 0).url.searchParams.get("fields")).toContain("inventory")
  })

  it("404 -> null", async () => {
    responde(Response.json({ message: "no existe" }, { status: 404 }))
    expect(await getItemParaPrecios(real, "9")).toBeNull()
  })

  it("un unitCost de 0 se conserva como 0 (no se confunde con 'sin costo')", async () => {
    responde(Response.json({ ...ITEM, inventory: { unit: "unit", unitCost: 0 } }))
    expect((await getItemParaPrecios(real, "55"))?.unitCost).toBe(0)
  })
})

describe("actualizarPreciosItem (HTTP)", () => {
  const price = [
    { idPriceList: 1, price: 160.01 },
    { idPriceList: 5, price: 80 },
  ]
  const respuestaOk = { ...ITEM, price: [{ idPriceList: 1, name: "General", price: 160.01 }, { idPriceList: 5, name: "Mayorista", price: 80 }] }

  it("hace PUT /items/{id} con price[] completo e inventory {unit, unitCost}, 2 decimales", async () => {
    const f = responde(Response.json(respuestaOk))
    const r = await actualizarPreciosItem(real, "55", {
      price: [{ idPriceList: 1, price: 160.005 }, { idPriceList: 5, price: 80 }],
      inventory: { unit: "unit", unitCost: 60.5 },
    })
    const c = llamada(f, 0)
    expect(c.method).toBe("PUT")
    expect(c.url.pathname).toMatch(/\/items\/55$/)
    expect(c.body).toEqual({
      price,
      inventory: { unit: "unit", unitCost: 60.5 },
    })
    expect(r.prices[0].price).toBe(160.01)
  })

  it("sin inventory, el body lleva sólo price", async () => {
    const f = responde(Response.json(respuestaOk))
    await actualizarPreciosItem(real, "55", { price })
    expect(Object.keys(llamada(f, 0).body)).toEqual(["price"])
  })

  it("nunca manda negativeSale (omitirlo lo conserva en Alegra, ver el sondeo)", async () => {
    const f = responde(Response.json(respuestaOk), Response.json(respuestaOk))
    await actualizarPreciosItem(real, "55", { price, inventory: { unit: "unit", unitCost: 1, negativeSale: true } })
    await actualizarPreciosItem(real, "55", { price, inventory: { unit: "unit", unitCost: 1 } })
    expect("negativeSale" in llamada(f, 0).body.inventory).toBe(false)
    expect("negativeSale" in llamada(f, 1).body.inventory).toBe(false)
  })

  it("NO reintenta un 5xx: puede haberse aplicado", async () => {
    const f = responde(new Response("boom", { status: 503 }), Response.json(respuestaOk))
    await expect(actualizarPreciosItem(real, "55", { price })).rejects.toBeInstanceOf(AlegraHttpError)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("NO reintenta un corte de red", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed")
    })
    vi.stubGlobal("fetch", f)
    await expect(actualizarPreciosItem(real, "55", { price })).rejects.toBeInstanceOf(TypeError)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("429: reintenta una vez y luego lanza AlegraRateLimitError", async () => {
    vi.useFakeTimers()
    const f = responde(new Response("", { status: 429 }), new Response("", { status: 429 }), Response.json(respuestaOk))
    const p = actualizarPreciosItem(real, "55", { price })
    const visto = expect(p).rejects.toBeInstanceOf(AlegraRateLimitError)
    await vi.advanceTimersByTimeAsync(60_000)
    await visto
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("429 disfrazado de 400 también corta", async () => {
    const f = responde(Response.json({ code: 429, message: "Too many requests" }, { status: 400 }))
    await expect(actualizarPreciosItem(real, "55", { price }, { reintentos429: 0 })).rejects.toBeInstanceOf(AlegraRateLimitError)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("si la respuesta no trae el precio enviado: no_persistio", async () => {
    responde(Response.json({ ...ITEM, price: [{ idPriceList: 1, name: "General", price: 100 }, { idPriceList: 5, price: 80 }] }))
    const err = await actualizarPreciosItem(real, "55", { price }).catch((e) => e)
    expect(err).toBeInstanceOf(AlegraPrecioNoPersistioError)
    expect(err).toMatchObject({ idPriceList: "1", enviado: 160.01, recibido: 100 })
  })

  it("verificarListas acota qué se compara", async () => {
    responde(Response.json({ ...ITEM, price: [{ idPriceList: 1, price: 160.01 }, { idPriceList: 5, price: 79.99 }] }))
    await expect(actualizarPreciosItem(real, "55", { price, verificarListas: ["1"] })).resolves.toBeDefined()
  })

  it("rechaza un precio inválido antes de llamar", async () => {
    const f = responde(Response.json(respuestaOk))
    await expect(actualizarPreciosItem(real, "55", { price: [{ idPriceList: 1, price: Number.NaN }] })).rejects.toThrow()
    expect(f).not.toHaveBeenCalled()
  })
})

describe("actualizarPreciosItem (mock)", () => {
  it("no hace HTTP y deja el precio nuevo en el 'vivo' del ítem", async () => {
    const f = vi.fn()
    vi.stubGlobal("fetch", f)
    const antes = await getItemParaPrecios(mock, "it-1")
    expect(antes?.price.map((p) => p.price)).toEqual([1890, 1490])
    const r = await actualizarPreciosItem(mock, "it-1", { price: [{ idPriceList: "1", price: 2000.55 }, { idPriceList: "2", price: 1490 }] })
    expect(r.prices.map((p) => p.price)).toEqual([2000.55, 1490])
    expect(__mockPutsRecibidos()).toHaveLength(1)
    expect(f).not.toHaveBeenCalled()
  })

  it("simula 429, 404 y 'no persiste'", async () => {
    const price = [{ idPriceList: "1", price: 1 }]
    __setMockPutModo("429")
    await expect(actualizarPreciosItem(mock, "it-2", { price })).rejects.toBeInstanceOf(AlegraRateLimitError)
    __setMockPutModo("ok")
    await expect(actualizarPreciosItem(mock, "no-existe", { price })).rejects.toMatchObject({ status: 404 })
    __setMockPutModo("no_persiste")
    await expect(actualizarPreciosItem(mock, "it-2", { price })).rejects.toBeInstanceOf(AlegraPrecioNoPersistioError)
  })
})
