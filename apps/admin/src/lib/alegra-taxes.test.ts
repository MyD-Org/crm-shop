import { afterEach, describe, expect, it, vi } from "vitest"
import { __clearTaxesCache, listTaxes } from "./alegra"
import { mockTaxes } from "./mock-alegra"
import type { TenantConfig } from "./tenants"

// listTaxes: GET /taxes de Alegra, con caché de 60s por tenant — mismo patrón que
// listNumberTemplates (rebanada C: "Emitir factura" necesita mapear iva_porcentaje → id de
// impuesto de Alegra, y el preview puede reabrirse varias veces sobre el mismo pedido).

const tenant = { id: "t1", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig

function responde(...respuestas: Response[]) {
  const fetchMock = vi.fn(async () => respuestas.shift() ?? new Response("{}", { status: 500 }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  __clearTaxesCache()
})

describe("listTaxes", () => {
  it("mapea el crudo de /taxes a AlegraTax", async () => {
    responde(Response.json([{ id: "1", name: "IVA 21%", percentage: 21, status: "active" }]))
    const r = await listTaxes(tenant)
    expect(r).toEqual([{ alegraId: "1", name: "IVA 21%", percentage: 21, status: "active" }])
  })

  it("pega a GET /taxes", async () => {
    const f = responde(Response.json([]))
    await listTaxes(tenant)
    const url = new URL(String((f.mock.calls[0] as unknown[])[0]))
    expect(url.pathname).toMatch(/\/taxes$/)
  })

  it("modo mock: usa mockTaxes (4 fixtures, con la de 27% inactiva)", async () => {
    const mock = { ...tenant, alegraMock: true } as TenantConfig
    const r = await listTaxes(mock)
    expect(r).toEqual(mockTaxes)
  })
})

describe("listTaxes — caché por tenant, TTL 60s", () => {
  it("dos llamadas seguidas dentro del TTL hacen un solo GET", async () => {
    const f = responde(Response.json([]), Response.json([]))
    const otroTenant = { ...tenant, id: "tax-cache-1" } as TenantConfig
    await listTaxes(otroTenant)
    await listTaxes(otroTenant)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("pasado el TTL, hace un segundo GET", async () => {
    vi.useFakeTimers()
    try {
      const f = responde(Response.json([]), Response.json([]))
      const otroTenant = { ...tenant, id: "tax-cache-2" } as TenantConfig
      await listTaxes(otroTenant)
      vi.advanceTimersByTime(61_000)
      await listTaxes(otroTenant)
      expect(f).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("dos tenants distintos no comparten caché", async () => {
    const f = responde(Response.json([]), Response.json([]))
    await listTaxes({ ...tenant, id: "tax-cache-3a" } as TenantConfig)
    await listTaxes({ ...tenant, id: "tax-cache-3b" } as TenantConfig)
    expect(f).toHaveBeenCalledTimes(2)
  })
})
