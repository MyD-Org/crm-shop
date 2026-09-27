import { afterEach, describe, expect, it, vi } from "vitest"
import { __clearNumberTemplatesCache, listNumberTemplates } from "./alegra"
import { mockNumberTemplates } from "./mock-alegra"
import type { TenantConfig } from "./tenants"
import numberTemplatesFixture from "./__fixtures__/alegra-number-templates.json"

// listNumberTemplates: GET /number-templates de Alegra, filtrado a documentType === "invoice"
// y mapeado a AlegraNumberTemplate. "Presupuesto X" (INVOICE_X) ES de documentType invoice en la
// cuenta real: tiene que aparecer (se puede emitir con X aunque el pedido tenga aviso de IVA).
// Fetch falso: nada sale a la red. Shape real confirmado el 2026-09-26 (ver A.1.1, fixture
// alegra-number-templates.json que reemplaza la llamada en vivo).

const tenant = { id: "t1", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig

function responde(...respuestas: Response[]) {
  const fetchMock = vi.fn(async () => respuestas.shift() ?? new Response("{}", { status: 500 }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  __clearNumberTemplatesCache()
})

describe("listNumberTemplates", () => {
  it("mapea el shape real de /number-templates a AlegraNumberTemplate", async () => {
    responde(Response.json(numberTemplatesFixture.data))
    const r = await listNumberTemplates(tenant)
    expect(r.find((x) => x.alegraId === "1")).toEqual({
      alegraId: "1",
      name: "Factura A",
      prefix: "0001",
      subDocumentType: "INVOICE_A",
      isElectronic: false,
      status: "active",
    })
  })

  it("filtra a documentType === 'invoice': incluye Presupuesto X y excluye otros documentos", async () => {
    const conRemito = [
      ...numberTemplatesFixture.data,
      { id: "30", name: "Remitos", prefix: "00001", status: "active", documentType: "remission", subDocumentType: "", isElectronic: false },
    ]
    responde(Response.json(conRemito))
    const r = await listNumberTemplates(tenant)
    expect(r.map((x) => x.alegraId).sort()).toEqual(["1", "18", "2", "3"])
    expect(r.find((x) => x.alegraId === "18")?.subDocumentType).toBe("INVOICE_X")
  })

  it("no filtra por status: una numeración inactiva de invoice igual aparece", async () => {
    const conInactiva = [
      ...numberTemplatesFixture.data,
      {
        id: "4",
        name: "Factura A (punto de venta 2, dado de baja)",
        prefix: "0004",
        isDefault: false,
        status: "inactive",
        documentType: "invoice",
        isElectronic: false,
        subDocumentType: "INVOICE_A",
        nextInvoiceNumber: 1,
        autoincrement: true,
      },
    ]
    responde(Response.json(conInactiva))
    const r = await listNumberTemplates(tenant)
    expect(r.find((x) => x.alegraId === "4")).toMatchObject({ status: "inactive" })
  })

  it("pega a GET /number-templates", async () => {
    const f = responde(Response.json(numberTemplatesFixture.data))
    await listNumberTemplates(tenant)
    const url = new URL(String((f.mock.calls[0] as unknown[])[0]))
    expect(url.pathname).toMatch(/\/number-templates$/)
  })

  it("modo mock: usa mockNumberTemplates (5 fixtures, incluye una inactiva)", async () => {
    const mock = { ...tenant, alegraMock: true } as TenantConfig
    const r = await listNumberTemplates(mock)
    // mockNumberTemplates trae A, B, C activas, una cuarta de invoice inactiva y "Presupuesto X"
    // (también invoice, como en la cuenta real).
    expect(r).toHaveLength(mockNumberTemplates.filter((x) => x.documentType === "invoice").length)
    expect(r.some((x) => x.name === "Presupuesto X")).toBe(true)
  })
})

describe("listNumberTemplates — caché por tenant, TTL 60s", () => {
  it("dos llamadas seguidas dentro del TTL hacen un solo GET", async () => {
    const f = responde(Response.json(numberTemplatesFixture.data), Response.json(numberTemplatesFixture.data))
    const otroTenant = { ...tenant, id: "cache-1" } as TenantConfig
    await listNumberTemplates(otroTenant)
    await listNumberTemplates(otroTenant)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("pasado el TTL, hace un segundo GET", async () => {
    vi.useFakeTimers()
    try {
      const f = responde(Response.json(numberTemplatesFixture.data), Response.json(numberTemplatesFixture.data))
      const otroTenant = { ...tenant, id: "cache-2" } as TenantConfig
      await listNumberTemplates(otroTenant)
      vi.advanceTimersByTime(61_000)
      await listNumberTemplates(otroTenant)
      expect(f).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("dos tenants distintos no comparten caché", async () => {
    const f = responde(Response.json(numberTemplatesFixture.data), Response.json(numberTemplatesFixture.data))
    await listNumberTemplates({ ...tenant, id: "cache-3a" } as TenantConfig)
    await listNumberTemplates({ ...tenant, id: "cache-3b" } as TenantConfig)
    expect(f).toHaveBeenCalledTimes(2)
  })
})
