import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AlegraHttpError, AlegraRateLimitError, paginaDeContactos } from "./alegra"
import type { TenantConfig } from "./tenants"

// Una página del padrón de contactos para la sync por tramos. `/contacts` admite ~5 requests
// por minuto por cuenta y el portal y el bot comparten ese cupo: por eso la sync no reintenta
// el 429 (corta el tramo y sigue en la próxima invocación).

const tenant = { id: "t", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig

const fetchMock = vi.fn()

function pagina(desde: number, n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: desde + i, name: `Contacto ${desde + i}` }))
}

/** Padrón de `total` contactos, servido según ?start=. */
function padron(total: number) {
  fetchMock.mockImplementation(async (url: string) => {
    const start = Number(new URL(url).searchParams.get("start"))
    return new Response(JSON.stringify(pagina(start, Math.max(0, Math.min(30, total - start)))), { status: 200 })
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("paginaDeContactos", () => {
  it("pide UNA página de 30 desde `start` y la devuelve cruda", async () => {
    padron(75)
    const onRequest = vi.fn()
    const page = await paginaDeContactos(tenant, 60, { onRequest })
    expect(page).toHaveLength(15)
    expect(page[0]).toEqual({ id: 60, name: "Contacto 60" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toMatch(/\/contacts$/)
    expect(url.searchParams.get("start")).toBe("60")
    expect(url.searchParams.get("limit")).toBe("30")
    expect(onRequest).toHaveBeenCalledTimes(1)
  })

  it("después de la última: página vacía", async () => {
    padron(60)
    expect(await paginaDeContactos(tenant, 60)).toEqual([])
  })

  it("429 (o el 400 con code 429 del tope de /contacts): NO reintenta por defecto", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 429, message: "Too many requests" }), { status: 400 }))
    const onRequest = vi.fn()
    await expect(paginaDeContactos(tenant, 0, { onRequest })).rejects.toBeInstanceOf(AlegraRateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRequest).toHaveBeenCalledTimes(1)
  })

  it("con reintentos429 explícitos, espera y reintenta contando cada request", async () => {
    vi.useFakeTimers()
    let primera = true
    fetchMock.mockImplementation(async () => {
      if (primera) {
        primera = false
        return new Response("rate limit", { status: 429, headers: { "retry-after": "2" } })
      }
      return new Response(JSON.stringify(pagina(0, 30)), { status: 200 })
    })
    const onRequest = vi.fn()
    const p = paginaDeContactos(tenant, 0, { onRequest, reintentos429: 1 })
    await vi.runAllTimersAsync()
    expect(await p).toHaveLength(30)
    expect(onRequest).toHaveBeenCalledTimes(2)
  })

  it("otros errores HTTP salen como AlegraHttpError con su status", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }))
    await expect(paginaDeContactos(tenant, 0)).rejects.toMatchObject({ status: 500 })
    await expect(paginaDeContactos(tenant, 0)).rejects.toBeInstanceOf(AlegraHttpError)
  })

  it("modo mock: pagina el mock sin tocar la red", async () => {
    const mock = { ...tenant, alegraMock: true } as TenantConfig
    const primera = await paginaDeContactos(mock, 0)
    expect(primera.length).toBeGreaterThan(0)
    expect(primera.length).toBeLessThanOrEqual(30)
    expect(await paginaDeContactos(mock, 100_000)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
