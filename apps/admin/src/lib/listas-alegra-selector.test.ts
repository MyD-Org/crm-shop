import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TenantConfig } from "./tenants"
import type { AlegraPriceList } from "./alegra"
import { combinarListasAlegra, leerListasDeAlegra, vaciarCacheListasAlegra } from "./listas-alegra-selector"

// Selector "Enlazar lista de Alegra": todas las listas de cada cuenta (GET /price-lists), con la
// cantidad de clientes del espejo y sin perder los enlaces ya cargados. Sin red ni DB.

const lista = (id: string, name: string): AlegraPriceList => ({ alegraId: id, name, type: null, status: "active" })
const base = { id: "tenant-a" } as unknown as TenantConfig

describe("combinarListasAlegra", () => {
  it("incluye las listas de la API aunque ningún contacto las tenga (0 clientes)", () => {
    const r = combinarListasAlegra({
      derivadas: [{ alegraAccount: "principal", alegraPriceListId: "2", nombre: "Mayorista", contactos: 7 }],
      enlaces: [],
      api: { principal: [lista("1", "General"), lista("2", "Mayorista"), lista("3", "Distribuidor")] },
      nombresCuenta: new Map([["principal", "Iguazú"]]),
    })
    expect(r.map((x) => [x.alegraPriceListId, x.nombre, x.contactos])).toEqual([
      ["1", "General", 0],
      ["2", "Mayorista", 7],
      ["3", "Distribuidor", 0],
    ])
    expect(r[0].cuentaNombre).toBe("Iguazú")
  })

  it("separa por cuenta y ordena por cuenta y por id numérico", () => {
    const r = combinarListasAlegra({
      derivadas: [],
      enlaces: [],
      api: { mdp: [lista("10", "B"), lista("9", "A")], principal: [lista("1", "General")] },
      nombresCuenta: new Map(),
    })
    expect(r.map((x) => `${x.alegraAccount}:${x.alegraPriceListId}`)).toEqual(["mdp:9", "mdp:10", "principal:1"])
  })

  it("conserva un enlace cuya lista ya no existe en Alegra", () => {
    const r = combinarListasAlegra({
      derivadas: [],
      enlaces: [{ alegraAccount: "principal", alegraPriceListId: "99" }],
      api: { principal: [lista("1", "General")] },
      nombresCuenta: new Map(),
    })
    expect(r.find((x) => x.alegraPriceListId === "99")).toMatchObject({ nombre: "Lista 99", contactos: 0 })
  })

  it("si la cuenta no se pudo leer (sin entrada en api), cae a lo derivado de los contactos", () => {
    const r = combinarListasAlegra({
      derivadas: [{ alegraAccount: "mdp", alegraPriceListId: "5", nombre: "Mayorista MDP", contactos: 3 }],
      enlaces: [],
      api: {},
      nombresCuenta: new Map(),
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ alegraAccount: "mdp", nombre: "Mayorista MDP", contactos: 3 })
  })

  it("el nombre de la API manda sobre el del contacto", () => {
    const r = combinarListasAlegra({
      derivadas: [{ alegraAccount: "principal", alegraPriceListId: "2", nombre: "viejo", contactos: 1 }],
      enlaces: [],
      api: { principal: [lista("2", "Mayorista")] },
      nombresCuenta: new Map(),
    })
    expect(r[0].nombre).toBe("Mayorista")
  })
})

describe("leerListasDeAlegra", () => {
  beforeEach(() => vaciarCacheListasAlegra())
  const objetivos = async () => [
    { tenant: "tenant-a", cuenta: "principal", config: base },
    { tenant: "tenant-a", cuenta: "mdp", config: base },
    { tenant: "tenant-a", cuenta: "sin-creds", config: null, motivoSalteo: "sin_credenciales" as const },
  ]

  it("lee cada cuenta, reporta las que fallan o no tienen credenciales y no tira", async () => {
    const listar = vi.fn(async (): Promise<AlegraPriceList[]> => {
      throw new Error("429")
    })
    listar.mockResolvedValueOnce([lista("1", "General")])
    const r = await leerListasDeAlegra(base, { objetivos, listar })
    expect(r.porCuenta.principal).toHaveLength(1)
    expect(r.porCuenta.mdp).toBeUndefined()
    expect([...r.cuentasFallidas].sort()).toEqual(["mdp", "sin-creds"])
  })

  it("cachea los aciertos por cuenta hasta que vence el TTL", async () => {
    const t = 1000
    const listar = vi.fn(async () => [lista("1", "General")])
    await leerListasDeAlegra(base, { objetivos, listar, ahora: () => t })
    await leerListasDeAlegra(base, { objetivos, listar, ahora: () => t + 1000 })
    expect(listar).toHaveBeenCalledTimes(2) // principal y mdp, una sola vez cada una
    await leerListasDeAlegra(base, { objetivos, listar, ahora: () => t + 60 * 60 * 1000 })
    expect(listar).toHaveBeenCalledTimes(4) // venció el TTL
  })
})
