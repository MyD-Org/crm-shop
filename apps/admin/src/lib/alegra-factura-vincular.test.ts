import { afterEach, describe, expect, it, vi } from "vitest"
import { AlegraHttpError, AlegraRateLimitError, buscarFacturasPorNumero, getFacturaPorId } from "./alegra"
import type { TenantConfig } from "./tenants"

// Lecturas de facturas para "Vincular factura" (detalle de pedido del admin). Fetch falso:
// nada sale a la red. Datos inventados.

const tenant = { id: "t", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig

const factura = {
  id: 7040,
  date: "2026-09-20",
  total: 1210.5,
  status: "open",
  numberTemplate: { fullNumber: "00201-00007040" },
  client: { id: 55, name: "Cliente Ejemplo SA" },
}

function responde(...respuestas: Response[]) {
  const fetchMock = vi.fn(async () => respuestas.shift() ?? new Response("{}", { status: 500 }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const urlDe = (f: ReturnType<typeof responde>, i = 0) => new URL(String((f.mock.calls[i] as unknown[])[0]))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("getFacturaPorId", () => {
  it("200 → resumen normalizado (número legible, cliente con nombre)", async () => {
    const f = responde(Response.json(factura))
    const r = await getFacturaPorId(tenant, "7040")
    expect(r).toEqual({
      alegraId: "7040",
      numero: "00201-00007040",
      fecha: "2026-09-20",
      total: 1210.5,
      estado: "open",
      clienteAlegraId: "55",
      clienteNombre: "Cliente Ejemplo SA",
    })
    expect(urlDe(f).pathname).toMatch(/\/invoices\/7040$/)
  })

  it("404 → null", async () => {
    responde(new Response('{"message":"no existe"}', { status: 404 }))
    expect(await getFacturaPorId(tenant, "7040")).toBeNull()
  })

  it("un id que no son dígitos no llega a Alegra", async () => {
    const f = responde()
    expect(await getFacturaPorId(tenant, "../items/5")).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it("429 → AlegraRateLimitError sin esperar reintentos largos", async () => {
    responde(new Response("", { status: 429 }), new Response("", { status: 429 }))
    await expect(getFacturaPorId(tenant, "7040", { reintentos429: 0 })).rejects.toBeInstanceOf(AlegraRateLimitError)
  })

  it("500 → AlegraHttpError", async () => {
    responde(new Response("caído", { status: 500 }))
    await expect(getFacturaPorId(tenant, "7040")).rejects.toBeInstanceOf(AlegraHttpError)
  })

  it("mock: busca en las fixtures", async () => {
    const mock = { ...tenant, alegraMock: true } as TenantConfig
    expect((await getFacturaPorId(mock, "inv-1"))?.numero).toBe("FV-1-00012876")
    expect(await getFacturaPorId(mock, "no-existe")).toBeNull()
  })
})

describe("buscarFacturasPorNumero", () => {
  it("filtra por numberTemplate_fullNumber, lo más reciente primero, una sola página", async () => {
    const f = responde(Response.json([factura]))
    const r = await buscarFacturasPorNumero(tenant, "00201-00007040")
    expect(r.map((x) => x.alegraId)).toEqual(["7040"])
    const url = urlDe(f)
    expect(url.pathname).toMatch(/\/invoices$/)
    expect(url.searchParams.get("numberTemplate_fullNumber")).toBe("00201-00007040")
    expect(url.searchParams.get("order_field")).toBe("date")
    expect(url.searchParams.get("order_direction")).toBe("DESC")
    expect(url.searchParams.get("limit")).toBe("30")
    expect(url.searchParams.has("client_id")).toBe(false)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("con clientId suma client_id", async () => {
    const f = responde(Response.json([]))
    await buscarFacturasPorNumero(tenant, "7040", { clientId: "55" })
    expect(urlDe(f).searchParams.get("client_id")).toBe("55")
  })

  it("respuesta que no es lista → []", async () => {
    responde(Response.json({ message: "raro" }))
    expect(await buscarFacturasPorNumero(tenant, "7040")).toEqual([])
  })

  it("mock: devuelve las fixtures (el llamador filtra por número)", async () => {
    const mock = { ...tenant, alegraMock: true } as TenantConfig
    const r = await buscarFacturasPorNumero(mock, "FV-1-00012876")
    expect(r.some((x) => x.numero === "FV-1-00012876")).toBe(true)
  })
})
