import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContactoEspejo } from "@/lib/contactos"

// El contrato de /api/agent/contacts (platform/contracts/crm-ai-api.md) NO cambia al pasar al
// espejo: mismas claves, mismos valores. Se mockea la fachada; nada toca Alegra ni la base.

const state = vi.hoisted(() => ({
  porTelefono: [] as unknown[],
  porTexto: [] as unknown[],
  creado: null as unknown,
  llamadas: [] as string[],
}))

vi.mock("@/lib/tenant-context", () => ({ getTenantConfig: async () => ({ id: "t1" }) }))
vi.mock("@/lib/agent-auth", () => ({
  authAgentTenantRequest: (req: Request) => (req.headers.get("authorization") ? { codigocliente: "c1" } : null),
}))
vi.mock("@/lib/contactos", () => ({
  buscarPorTelefono: async (_t: unknown, tel: string) => {
    state.llamadas.push(`telefono:${tel}`)
    return state.porTelefono
  },
  buscarPorTexto: async (_t: unknown, q: string) => {
    state.llamadas.push(`texto:${q}`)
    return state.porTexto
  },
  crearContacto: async () => {
    state.llamadas.push("crear")
    return state.creado
  },
}))

import { GET, POST } from "./route"

const contacto: ContactoEspejo = {
  alegraId: "42",
  name: "Iluminación Ejemplo SRL",
  identification: "20-12345678-9",
  email: "compras@cliente.example",
  phone: "+54 9 11 5555-0001",
  priceListId: "2",
  sellerId: "3",
  paymentTermId: "4",
  status: "active",
  paymentTermName: "15 días",
  paymentTermDays: 15,
  priceListName: "Mayorista",
  sellerName: "Vendedora Ejemplo",
  creditLimit: 100000,
  tipoCuenta: "corriente",
  types: ["client"],
  priceListStatus: "active",
  syncedAt: new Date(),
}

/** La forma exacta que devolvía la ruta antes del espejo (ni una clave más ni una menos). */
const FORMA = {
  id: "42",
  name: "Iluminación Ejemplo SRL",
  identification: "20-12345678-9",
  email: "compras@cliente.example",
  phone: "+54 9 11 5555-0001",
  price_list_id: "2",
  seller_id: "3",
  payment_term_id: "4",
}

const conAuth = (url: string, init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { authorization: "Bearer x", ...(init.headers ?? {}) } })

beforeEach(() => {
  state.porTelefono = []
  state.porTexto = []
  state.creado = null
  state.llamadas = []
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe("GET /api/agent/contacts", () => {
  it("?phone= busca por teléfono y responde la forma de siempre", async () => {
    state.porTelefono = [contacto]
    const res = await GET(conAuth("https://t1.plataforma.example/api/agent/contacts?phone=5491155550001"))
    expect(await res.json()).toStrictEqual({ contacts: [FORMA] })
    expect(state.llamadas).toEqual(["telefono:5491155550001"])
  })

  it("phone tiene prioridad sobre q", async () => {
    await GET(conAuth("https://t1.plataforma.example/api/agent/contacts?phone=5491155550001&q=ejemplo"))
    expect(state.llamadas).toEqual(["telefono:5491155550001"])
  })

  it("?q= busca por texto", async () => {
    state.porTexto = [contacto]
    const res = await GET(conAuth("https://t1.plataforma.example/api/agent/contacts?q=iluminacion"))
    expect(await res.json()).toStrictEqual({ contacts: [FORMA] })
    expect(state.llamadas).toEqual(["texto:iluminacion"])
  })

  it("sin q ni phone: 400; sin token: 401", async () => {
    expect((await GET(conAuth("https://t1.plataforma.example/api/agent/contacts"))).status).toBe(400)
    expect((await GET(new Request("https://t1.plataforma.example/api/agent/contacts?q=x"))).status).toBe(401)
  })
})

describe("POST /api/agent/contacts", () => {
  it("crea con la fachada y responde la forma de siempre", async () => {
    state.creado = contacto
    const res = await POST(
      conAuth("https://t1.plataforma.example/api/agent/contacts", {
        method: "POST",
        body: JSON.stringify({ name: "Iluminación Ejemplo SRL", phone: "+54 9 11 5555-0001" }),
      }),
    )
    expect(await res.json()).toStrictEqual(FORMA)
    expect(state.llamadas).toEqual(["crear"])
  })
})
