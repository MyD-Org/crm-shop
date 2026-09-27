import { afterEach, describe, expect, it, vi } from "vitest"
import { createInvoice } from "./alegra"
import { mockAllInvoices } from "./mock-alegra"
import type { TenantConfig } from "./tenants"

// createInvoice: POST /invoices real (rebanada A, solo capa de efectos — sin UI/endpoint
// todavía). Fetch falso: nada sale a la red en el modo no-mock. Escritura real e irreversible
// en producción; acá sólo se ejercita el shape del body y el mapeo de la respuesta.

const tenant = { id: "t1", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig

const input = {
  contactAlegraId: "55",
  items: [
    { alegraId: "it-1", quantity: 2, price: 1890 },
    { alegraId: "it-2", quantity: 1, price: 1590 },
  ],
  numberTemplate: { id: "1" },
}

function responde(...respuestas: Response[]) {
  const fetchMock = vi.fn(async () => respuestas.shift() ?? new Response("{}", { status: 500 }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createInvoice", () => {
  it("arma el body con numberTemplate (siempre presente), cliente e ítems", async () => {
    const f = responde(
      Response.json({ id: 9001, date: "2026-09-26", total: 5370, numberTemplate: { fullNumber: "0001-00000042" } }),
    )
    await createInvoice(tenant, input)
    const call = f.mock.calls[0] as unknown[]
    const url = new URL(String(call[0]))
    const body = JSON.parse(String((call[1] as RequestInit).body))
    expect(url.pathname).toMatch(/\/invoices$/)
    expect(body.numberTemplate).toEqual({ id: 1 })
    expect(body.client).toBe(55)
    expect(body.items).toEqual([
      { id: "it-1", quantity: 2, price: 1890 },
      { id: "it-2", quantity: 1, price: 1590 },
    ])
  })

  it("devuelve AlegraInvoiceCreated a partir de la respuesta", async () => {
    responde(Response.json({ id: 9001, date: "2026-09-26", total: 5370, numberTemplate: { fullNumber: "0001-00000042" } }))
    const r = await createInvoice(tenant, input)
    expect(r).toEqual({ alegraId: "9001", number: "0001-00000042", date: "2026-09-26", total: 5370 })
  })

  it("modo mock: agrega a mockAllInvoices() y devuelve un alegraId incremental", async () => {
    const mock = { ...tenant, alegraMock: true } as TenantConfig
    const antes = mockAllInvoices().length
    const r = await createInvoice(mock, input)
    expect(mockAllInvoices()).toHaveLength(antes + 1)
    expect(mockAllInvoices().some((i) => i.alegraId === r.alegraId)).toBe(true)
    expect(r.date).toBe(new Date().toISOString().slice(0, 10))
  })
})

describe("hoyArgentina", () => {
  it("usa la fecha de Argentina, no la de UTC", async () => {
    const { hoyArgentina } = await import("./alegra")
    // 23:30 del 26/09 en Argentina = 02:30 UTC del 27/09
    expect(hoyArgentina(new Date("2026-09-27T02:30:00Z"))).toBe("2026-09-26")
    expect(hoyArgentina(new Date("2026-09-26T15:00:00Z"))).toBe("2026-09-26")
  })
})
