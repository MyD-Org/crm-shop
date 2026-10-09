import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mintAgentToken } from "@/lib/agent-token"

// /api/agent/sales-config expone configuración interna de la cuenta de Alegra (vendedores,
// listas de precio, impuestos), así que sólo acepta INTERNAL_SECRET. Acá se usa la auth REAL
// (lib/agent-auth.ts): un crm_token válido del cliente logueado, que llega a su navegador dentro
// del JWT del widget, tiene que dar 401 sin tocar Alegra.

const state = vi.hoisted(() => ({ llamadas: [] as string[] }))

vi.mock("@/lib/tenant-context", () => ({ getTenantConfig: async () => ({ id: "t1" }) }))
vi.mock("@/lib/alegra", () => ({
  listPriceLists: async () => {
    state.llamadas.push("listas")
    return [
      { alegraId: "1", name: "General", status: "active" },
      { alegraId: "2", name: "Vieja", status: "inactive" },
    ]
  },
  listPaymentTerms: async () => {
    state.llamadas.push("terminos")
    return [{ alegraId: "4", name: "30 días", days: 30 }]
  },
  listSellers: async () => {
    state.llamadas.push("vendedores")
    return [{ alegraId: "7", name: "Vendedor Ejemplo", status: "active" }]
  },
  listTaxes: async () => {
    state.llamadas.push("impuestos")
    return [{ alegraId: "3", name: "IVA 21%", percentage: 21, status: "active" }]
  },
  listCurrencies: async () => {
    state.llamadas.push("monedas")
    return [{ code: "ARS", name: "Peso argentino", symbol: "$" }]
  },
}))

import { GET } from "./route"

const INTERNAL = "internal-secret-de-test-para-vitest-nada-real"
const con = (auth?: string) =>
  new Request("https://t1.plataforma.example/api/agent/sales-config", {
    headers: auth ? { authorization: auth } : {},
  })

beforeEach(() => {
  state.llamadas = []
  vi.stubEnv("INTERNAL_SECRET", INTERNAL)
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("/api/agent/sales-config — auth server-to-server", () => {
  it("con INTERNAL_SECRET responde 200 con la configuración activa", async () => {
    const res = await GET(con(`Bearer ${INTERNAL}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      price_lists: [{ id: "1", name: "General" }],
      payment_terms: [{ id: "4", name: "30 días", days: 30 }],
      sellers: [{ id: "7", name: "Vendedor Ejemplo" }],
      taxes: [{ id: "3", name: "IVA 21%", percentage: 21 }],
      currencies: [{ code: "ARS", name: "Peso argentino", symbol: "$" }],
    })
    expect(state.llamadas.sort()).toEqual(["impuestos", "listas", "monedas", "terminos", "vendedores"])
  })

  it("con un crm_token válido del mismo tenant responde 401 y no toca Alegra", async () => {
    const res = await GET(con(`Bearer ${mintAgentToken("CLI-1", "t1")}`))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthorized" })
    expect(state.llamadas).toEqual([])
  })

  it("sin Authorization responde 401", async () => {
    const res = await GET(con())
    expect(res.status).toBe(401)
    expect(state.llamadas).toEqual([])
  })
})
