import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContactoEspejo } from "./contactos"
import type { TenantConfig } from "./tenants"

// erp.ts lee los contactos de la fachada del espejo (lib/contactos.ts), nunca de /contacts en
// vivo. Se mockea la fachada y se espía fetch: lo único que puede salir a Alegra son las
// facturas (saldo), que no cambian con este cambio.

const state = vi.hoisted(() => ({
  porId: null as unknown,
  porDocumento: null as unknown,
  activos: [] as unknown[],
  errorPorId: null as Error | null,
  llamadas: [] as string[],
}))

vi.mock("./contactos", () => ({
  contactoPorId: async (_c: unknown, id: string) => {
    state.llamadas.push(`id:${id}`)
    if (state.errorPorId) throw state.errorPorId
    return state.porId
  },
  contactoPorDocumento: async (_c: unknown, doc: string) => {
    state.llamadas.push(`documento:${doc}`)
    return state.porDocumento
  },
  clientesActivos: async () => {
    state.llamadas.push("activos")
    return state.activos
  },
}))

import { AlegraRateLimitError } from "./alegra"
import { getCliente, getClienteByIdentifier, getClientes, getCondiciones } from "./erp"

const tenant = { id: "t", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig

const contacto = (extra: Partial<ContactoEspejo> = {}): ContactoEspejo => ({
  alegraId: "42",
  name: "Cliente Ejemplo SA",
  identification: "20-12345678-9",
  email: "compras@cliente.example",
  phone: null,
  priceListId: null,
  sellerId: null,
  paymentTermId: null,
  status: "active",
  paymentTermName: null,
  // Plazo 0 y sin límite: el cálculo viejo diría "contado". La columna dice otra cosa y gana.
  paymentTermDays: 0,
  priceListName: null,
  sellerName: null,
  creditLimit: null,
  tipoCuenta: "corriente",
  types: ["client"],
  priceListStatus: null,
  syncedAt: new Date(),
  ...extra,
})

const fetchMock = vi.fn()
const pathsPedidos = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)

beforeEach(() => {
  state.porId = null
  state.porDocumento = null
  state.activos = []
  state.errorPorId = null
  state.llamadas = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response("[]", { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("erp sobre el espejo de contactos", () => {
  it("getClienteByIdentifier (login): del espejo por documento, 0 requests a /contacts", async () => {
    state.porDocumento = contacto()
    const c = await getClienteByIdentifier(tenant, "20123456789")
    expect(c).toMatchObject({ codigocliente: "42", email: "compras@cliente.example", tipoCuenta: "corriente" })
    expect(state.llamadas).toEqual(["documento:20123456789"])
    expect(pathsPedidos().some((p) => p.includes("/contacts"))).toBe(false)
  })

  it("getClienteByIdentifier: documento que no está → null", async () => {
    expect(await getClienteByIdentifier(tenant, "20999999998")).toBeNull()
  })

  it("getCliente por id; tipoCuenta sale de la columna, no se recalcula", async () => {
    state.porId = contacto({ tipoCuenta: "contado", paymentTermDays: 30 })
    expect((await getCliente(tenant, "42")).tipoCuenta).toBe("contado")
    expect(pathsPedidos().some((p) => p.includes("/contacts"))).toBe(false)
  })

  it("getCliente de un id que no existe tira como antes", async () => {
    await expect(getCliente(tenant, "404")).rejects.toThrow("no encontrado")
  })

  it("getClientes (cobranza): del espejo, sin ninguna request", async () => {
    state.activos = [contacto(), contacto({ alegraId: "43" })]
    expect((await getClientes(tenant)).map((c) => c.codigocliente)).toEqual(["42", "43"])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("getCondiciones: si leer el contacto falla (no 429), muestra lo propio; un 429 se propaga", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.errorPorId = new Error("caído")
    await expect(getCondiciones(tenant, "42")).resolves.toMatchObject({ condicionPago: null })
    state.errorPorId = new AlegraRateLimitError("/contacts/42", "")
    await expect(getCondiciones(tenant, "42")).rejects.toBeInstanceOf(AlegraRateLimitError)
  })
})
