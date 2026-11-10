import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AlegraHttpError, esErrorTransitorio, listItemsLote, probarConexionAlegra } from "./alegra"
import type { TenantConfig } from "./tenants"

// La sync del catálogo grande lee ~750 páginas seguidas: un 5xx o un corte de red en UNA sola
// página tiraba la cuenta entera (pasó del 2 al 10/11/2026). Al paginar se reintenta esa página.

const CONFIG: TenantConfig = {
  id: "t",
  name: "T",
  subtitle: "",
  logoPath: "",
  alegraEmail: "a@empresa.example",
  alegraToken: "tk-de-prueba",
  alegraMock: false,
  whatsappNumber: "",
  resendFrom: "x@empresa.example",
  receiptsEmail: "",
  aiApiBaseUrl: "",
  aiApiKey: "",
  aiAgentId: "",
  aiTenantId: "",
}

const respuesta = (status: number, body: unknown = []) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("esErrorTransitorio", () => {
  it("5xx de gateway o servidor caído sí", () => {
    for (const s of [500, 502, 503, 504]) expect(esErrorTransitorio({ status: s }), String(s)).toBe(true)
  })
  it("errores de datos o credenciales no", () => {
    for (const s of [400, 401, 403, 404, 422]) expect(esErrorTransitorio({ status: s }), String(s)).toBe(false)
  })
  it("corte de red o timeout sí", () => {
    expect(esErrorTransitorio({ error: new TypeError("fetch failed") })).toBe(true)
    expect(esErrorTransitorio({ error: new DOMException("timeout", "TimeoutError") })).toBe(true)
  })
})

describe("paginado con errores transitorios", () => {
  it("un 503 en una página se reintenta y el lote sale completo", async () => {
    let llamadas = 0
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        llamadas++
        return llamadas === 1 ? respuesta(503, "upstream") : respuesta(200, [])
      }),
    )
    const p = listItemsLote(CONFIG, 0)
    await vi.runAllTimersAsync()
    await expect(p).resolves.toMatchObject({ fin: true })
  })

  it("un corte de red se reintenta", async () => {
    let llamadas = 0
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        llamadas++
        if (llamadas === 1) throw new TypeError("fetch failed")
        return respuesta(200, [])
      }),
    )
    const p = listItemsLote(CONFIG, 0)
    await vi.runAllTimersAsync()
    await expect(p).resolves.toMatchObject({ fin: true })
  })

  it("si el 5xx sigue, después de los reintentos falla con AlegraHttpError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => respuesta(502, "bad gateway")))
    const p = listItemsLote(CONFIG, 0)
    const assertion = expect(p).rejects.toBeInstanceOf(AlegraHttpError)
    await vi.runAllTimersAsync()
    await assertion
  })

  it("un 400 no se reintenta", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => respuesta(400, { code: 1, message: "mal" }))
    vi.stubGlobal("fetch", fetchMock)
    const p = listItemsLote(CONFIG, 0)
    const assertion = expect(p).rejects.toBeInstanceOf(AlegraHttpError)
    await vi.runAllTimersAsync()
    await assertion
    // Una request por página del grupo, sin reintentos.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4)
  })
})

describe("fuera del paginado no cambia", () => {
  it("la prueba de conexión no reintenta un 500", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(500, "boom"))
    vi.stubGlobal("fetch", fetchMock)
    const p = probarConexionAlegra(CONFIG)
    await vi.runAllTimersAsync()
    await expect(p).resolves.toMatchObject({ ok: false, motivo: "error" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("los listados que no son del catálogo no reintentan", () => {
  it("un 500 al listar facturas falla de una", async () => {
    const { listInvoicesByContact } = await import("./alegra")
    const fetchMock = vi.fn().mockImplementation(async () => respuesta(500, "boom"))
    vi.stubGlobal("fetch", fetchMock)
    await expect(listInvoicesByContact(CONFIG, "1")).rejects.toBeInstanceOf(AlegraHttpError)
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4)
  })
})
