import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AlegraRateLimitError, esLimiteDisfrazado, findContactByIdentifier, findContactRawByIdentifier, variantesDocumento } from "./alegra"
import type { TenantConfig } from "./tenants"

// Login del portal: resolver el contacto por CUIT/DNI sin bajar el padrón entero.
// El endpoint es anónimo; antes un CUIT inventado disparaba ~200 requests a Alegra.

const tenant = { id: "t", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig

const fetchMock = vi.fn()

/** Responde según los query params de la request; registra cada llamada. */
function alegra(responder: (params: URLSearchParams) => unknown[] | Response) {
  fetchMock.mockImplementation(async (url: string) => {
    const r = responder(new URL(url).searchParams)
    return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200 })
  })
}

const params = () =>
  fetchMock.mock.calls.map(([url]) => {
    const p = new URL(url as string).searchParams
    p.delete("limit")
    return p.toString()
  })

const contacto = (extra: Record<string, unknown>) => ({ id: 42, name: "ACME SRL", status: "active", ...extra })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("variantesDocumento", () => {
  it("tal cual, solo dígitos y CUIT con guiones, sin repetir", () => {
    expect(variantesDocumento("20123456789")).toEqual(["20123456789", "20-12345678-9"])
    expect(variantesDocumento(" 20-12345678-9 ")).toEqual(["20-12345678-9", "20123456789"])
    expect(variantesDocumento("20.123.456.789")).toEqual(["20.123.456.789", "20123456789", "20-12345678-9"])
    // Un DNI no lleva guiones de CUIT.
    expect(variantesDocumento("12345678")).toEqual(["12345678"])
  })
})

describe("findContactByIdentifier", () => {
  it("CUIT inexistente: como mucho 4 requests (variantes + query=)", async () => {
    alegra(() => [])
    expect(await findContactByIdentifier(tenant, "20123456789")).toBeNull()
    expect(params()).toEqual([
      "identification=20123456789",
      "identification=20-12345678-9",
      "query=20123456789",
    ])
  })

  it("CUIT cargado con guiones en Alegra: lo encuentra con la variante", async () => {
    alegra((p) => (p.get("identification") === "20-12345678-9" ? [contacto({ identification: "20-12345678-9" })] : []))
    const c = await findContactByIdentifier(tenant, "20123456789")
    expect(c?.alegraId).toBe("42")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("exige match exacto: un parecido en la lista no entra", async () => {
    alegra(() => [contacto({ identification: "20111111112" })])
    expect(await findContactByIdentifier(tenant, "20123456789")).toBeNull()
  })

  it("si un filtro falla (no 429), prueba el siguiente", async () => {
    alegra((p) =>
      p.get("identification") === "20123456789"
        ? new Response("bad request", { status: 400 })
        : [contacto({ identification: "20123456789" })],
    )
    const c = await findContactByIdentifier(tenant, "20123456789")
    expect(c?.alegraId).toBe("42")
  })

  it("DNI: una variante (no lleva guiones) y query=", async () => {
    alegra(() => [])
    expect(await findContactByIdentifier(tenant, "12345678")).toBeNull()
    expect(params()).toEqual(["identification=12345678", "query=12345678"])
  })
})

describe("findContactRawByIdentifier", () => {
  it("CUIT cargado con guiones: devuelve el crudo de Alegra, sin mapear", async () => {
    const raw = contacto({ identification: "20-12345678-9", term: { id: 3, days: "30" } })
    alegra((p) => (p.get("identification") === "20-12345678-9" ? [raw] : []))
    expect(await findContactRawByIdentifier(tenant, "20123456789")).toEqual(raw)
    expect(params()).toEqual(["identification=20123456789", "identification=20-12345678-9"])
  })

  it("un 429 corta: no prueba las variantes que faltan", async () => {
    vi.useFakeTimers()
    try {
      alegra(() => new Response("rate limit", { status: 429 }))
      const p = findContactRawByIdentifier(tenant, "20123456789")
      const esperado = expect(p).rejects.toBeInstanceOf(AlegraRateLimitError)
      await vi.runAllTimersAsync()
      await esperado
      // Todas las llamadas son reintentos de la PRIMERA variante.
      expect(new Set(params())).toEqual(new Set(["identification=20123456789"]))
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * `/contacts` avisa el límite con un 400 que trae el 429 en el body. Antes el login lo
 * tomaba como "este filtro no sirvió", probaba el siguiente y respondía "no encontramos
 * una cuenta" con Alegra saturado.
 */
describe("límite de Alegra disfrazado de 400", () => {
  const limite = () =>
    new Response(JSON.stringify({ code: 429, message: "Too many requests" }), { status: 400 })

  it("esLimiteDisfrazado distingue el 400 con code 429 de un 400 común", () => {
    expect(esLimiteDisfrazado(400, '{"code":429,"message":"Too many requests"}')).toBe(true)
    expect(esLimiteDisfrazado(400, '{"code":1001,"message":"parámetro inválido"}')).toBe(false)
    expect(esLimiteDisfrazado(400, "no es json")).toBe(false)
    expect(esLimiteDisfrazado(500, '{"code":429}')).toBe(false)
  })

  it("reintenta y encuentra el contacto cuando el límite se libera", async () => {
    vi.useFakeTimers()
    let n = 0
    fetchMock.mockImplementation(async () =>
      n++ === 0 ? limite() : new Response(JSON.stringify([contacto({ identification: "20123456789" })]), { status: 200 }),
    )
    const p = findContactByIdentifier(tenant, "20123456789")
    await vi.runAllTimersAsync()
    expect((await p)?.alegraId).toBe("42")
    vi.useRealTimers()
  })

  it("si el límite persiste tira AlegraRateLimitError, nunca 'no encontrado'", async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => limite())
    const p = findContactByIdentifier(tenant, "20123456789")
    const esperado = expect(p).rejects.toBeInstanceOf(AlegraRateLimitError)
    await vi.runAllTimersAsync()
    await esperado
    vi.useRealTimers()
  })

  it("un 400 común de un filtro sigue pasando al filtro siguiente", async () => {
    alegra((p) =>
      p.get("identification") === "20123456789"
        ? new Response(JSON.stringify({ code: 1001, message: "inválido" }), { status: 400 })
        : [contacto({ identification: "20123456789" })],
    )
    expect((await findContactByIdentifier(tenant, "20123456789"))?.alegraId).toBe("42")
  })
})
