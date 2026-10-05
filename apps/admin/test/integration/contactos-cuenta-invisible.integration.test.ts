import { describe, it, expect, beforeEach, vi } from "vitest"
import { mapRawContactRow } from "@/lib/alegra"
import { upsertContactos } from "@/lib/alegra-contacts-repo"
import type { TenantConfig } from "@/lib/tenants"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Invisibilidad de las filas de cuentas secundarias (change `espejo-contactos-por-cuenta`,
 * rebanada A): el espejo ya guarda filas 'mdp', pero NINGÚN lector las ve todavía. Estos tests
 * valen para el buscador del admin, el login del portal y el bot, que leen por la fachada
 * `lib/contactos.ts`. Alegra queda mockeado (cualquier lectura en vivo devuelve vacío). Datos
 * inventados.
 */

const vivo = vi.hoisted(() => ({
  getContactRaw: vi.fn(),
  findContactRawByIdentifier: vi.fn(),
  searchContactsRaw: vi.fn(),
  createContactRaw: vi.fn(),
}))

vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  getContactRaw: vivo.getContactRaw,
  findContactRawByIdentifier: vivo.findContactRawByIdentifier,
  searchContactsRaw: vivo.searchContactsRaw,
  createContactRaw: vivo.createContactRaw,
}))

import { buscarPorTelefono, buscarPorTexto, clientesActivos, contactoPorDocumento, contactoPorId } from "@/lib/contactos"

const TENANT = "tenant-a"
const config = { id: TENANT, alegraMock: false, alegraToken: "token-de-prueba" } as unknown as TenantConfig

type Raw = Record<string, unknown>
const contacto = (id: number, extra: Raw = {}): Raw => ({ id, name: `Cliente ${id}`, status: "active", type: ["client"], ...extra })
const enMdp = (raws: Raw[]) => upsertContactos(TENANT, raws.map(mapRawContactRow), "sync", { cuenta: "mdp" })
const enIgz = (raws: Raw[]) => upsertContactos(TENANT, raws.map(mapRawContactRow), "sync")

beforeEach(async () => {
  await truncateAll()
  await seedTenant(TENANT)
  for (const f of Object.values(vivo)) f.mockReset()
  vivo.getContactRaw.mockResolvedValue(null)
  vivo.findContactRawByIdentifier.mockResolvedValue(null)
  vivo.searchContactsRaw.mockResolvedValue([])
})

describe("un cliente que solo existe en la cuenta 'mdp' no aparece en ningún lector", () => {
  const solo = contacto(9, {
    name: "Solo Mar del Plata SA",
    identification: "20-00000003-4",
    email: "mdp@cliente.example",
    phonePrimary: "+54 223 555-0009",
  })

  it("por documento, por id, por texto, por teléfono y en la lista de clientes", async () => {
    await enMdp([solo])
    expect(await contactoPorDocumento(config, "20000000034")).toBeNull()
    expect(await contactoPorId(config, "9")).toBeNull()
    expect(await buscarPorTexto(config, "Solo Mar del Plata")).toEqual([])
    expect(await buscarPorTelefono(config, "2235550009")).toEqual([])
    expect(await clientesActivos(config)).toEqual([])
  })

  it("con el mismo id en ambas cuentas, el lector ve solo los datos de la principal", async () => {
    await enIgz([contacto(15, { name: "Cliente IGZ", identification: "30-00000001-1", email: "igz@cliente.example" })])
    await enMdp([contacto(15, { name: "Cliente MDP", identification: "30-00000002-9", email: "mdp@cliente.example" })])

    expect((await contactoPorId(config, "15"))?.name).toBe("Cliente IGZ")
    expect((await clientesActivos(config)).map((c) => c.name)).toEqual(["Cliente IGZ"])
    expect(await contactoPorDocumento(config, "30000000029")).toBeNull()
    expect(await buscarPorTexto(config, "Cliente MDP")).toEqual([])
  })
})
