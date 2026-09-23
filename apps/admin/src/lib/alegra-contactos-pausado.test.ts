import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { listAllContactsPausado, SinTiempoError } from "./alegra"
import type { TenantConfig } from "./tenants"

// Sync del padrón de contactos: páginas de 30 de a una, con pausa entre requests para no
// comerse la cuota compartida (150 req/min) con el bot, el portal y el checkout.

const tenant = { id: "t", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig

const fetchMock = vi.fn()
/** Momento (ms del reloj falso) en que arrancó cada request. */
let inicios: number[] = []

function pagina(desde: number, n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: desde + i, name: `Contacto ${desde + i}` }))
}

/** Padrón de `total` contactos, servido según ?start=. */
function padron(total: number) {
  fetchMock.mockImplementation(async (url: string) => {
    inicios.push(Date.now())
    const start = Number(new URL(url).searchParams.get("start"))
    return new Response(JSON.stringify(pagina(start, Math.max(0, Math.min(30, total - start)))), { status: 200 })
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-23T12:00:00Z"))
  fetchMock.mockReset()
  inicios = []
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("listAllContactsPausado", () => {
  it("pide de a una página y corta en la página corta", async () => {
    padron(75)
    const p = listAllContactsPausado(tenant, { intervaloMs: 700 })
    await vi.runAllTimersAsync()
    const raws = await p
    expect(raws).toHaveLength(75)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const starts = fetchMock.mock.calls.map(([u]) => new URL(u as string).searchParams.get("start"))
    expect(starts).toEqual(["0", "30", "60"])
  })

  it("página exacta de 30 al final: una request más que vuelve vacía", async () => {
    padron(60)
    const p = listAllContactsPausado(tenant, { intervaloMs: 700 })
    await vi.runAllTimersAsync()
    expect(await p).toHaveLength(60)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("respeta el intervalo de inicio a inicio entre requests", async () => {
    padron(90)
    const p = listAllContactsPausado(tenant, { intervaloMs: 700 })
    await vi.runAllTimersAsync()
    await p
    const saltos = inicios.slice(1).map((t, i) => t - inicios[i])
    expect(saltos.length).toBeGreaterThan(0)
    for (const s of saltos) expect(s).toBeGreaterThanOrEqual(700)
  })

  it("429 con Retry-After: espera, reintenta y cuenta cada request", async () => {
    let primera = true
    fetchMock.mockImplementation(async (url: string) => {
      inicios.push(Date.now())
      if (primera) {
        primera = false
        return new Response("rate limit", { status: 429, headers: { "retry-after": "2" } })
      }
      const start = Number(new URL(url).searchParams.get("start"))
      return new Response(JSON.stringify(pagina(start, start === 0 ? 30 : 5)), { status: 200 })
    })
    const onRequest = vi.fn()
    const p = listAllContactsPausado(tenant, { intervaloMs: 700, onRequest })
    await vi.runAllTimersAsync()
    expect(await p).toHaveLength(35)
    // 429 + reintento de la página 0 + página 1.
    expect(onRequest).toHaveBeenCalledTimes(3)
    expect(inicios[1] - inicios[0]).toBeGreaterThanOrEqual(2000)
  })

  it("deadline vencido antes de una página → SinTiempoError ('sin_tiempo')", async () => {
    padron(300)
    const deadline = Date.now() + 1500
    const p = listAllContactsPausado(tenant, { intervaloMs: 700, deadline })
    const esperado = expect(p).rejects.toBeInstanceOf(SinTiempoError)
    await vi.runAllTimersAsync()
    await esperado
    await expect(p).rejects.toThrow("sin_tiempo")
    // 0 ms, 700 ms, 1400 ms: la cuarta (2100 ms) ya no se pide.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("onRequest cuenta una vez por página cuando no hay reintentos", async () => {
    padron(45)
    const onRequest = vi.fn()
    const p = listAllContactsPausado(tenant, { onRequest })
    await vi.runAllTimersAsync()
    await p
    expect(onRequest).toHaveBeenCalledTimes(2)
  })
})
