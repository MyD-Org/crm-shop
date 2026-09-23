import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { findContactByIdentifier, variantesDocumento } from "./alegra"
import type { TenantConfig } from "./tenants"

// Login del portal: resolver el contacto por email/CUIT sin bajar el padrón entero.
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
  it("email: lo encuentra con el filtro email= en UNA request", async () => {
    alegra((p) => (p.get("email") === "compras@cliente.example" ? [contacto({ email: "Compras@cliente.example" })] : []))
    const c = await findContactByIdentifier(tenant, "compras@cliente.example")
    expect(c?.alegraId).toBe("42")
    expect(params()).toEqual(["email=compras%40cliente.example"])
  })

  it("email inexistente: 2 requests (email= y query=) y null, nunca el padrón entero", async () => {
    alegra(() => [])
    expect(await findContactByIdentifier(tenant, "nadie@cliente.example")).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(params().some((p) => p.includes("start="))).toBe(false)
  })

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
    alegra(() => [contacto({ email: "otro@cliente.example", identification: "20111111112" })])
    expect(await findContactByIdentifier(tenant, "compras@cliente.example")).toBeNull()
    expect(await findContactByIdentifier(tenant, "20123456789")).toBeNull()
  })

  it("si un filtro falla (no 429), prueba el siguiente", async () => {
    alegra((p) =>
      p.has("email") ? new Response("bad request", { status: 400 }) : [contacto({ email: "compras@cliente.example" })],
    )
    const c = await findContactByIdentifier(tenant, "compras@cliente.example")
    expect(c?.alegraId).toBe("42")
  })
})
