import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraContacts } from "@/db/schema"
import { mapRawContactRow } from "@/lib/alegra"
import { upsertContactos } from "@/lib/alegra-contacts-repo"
import { procesarAvisoContacto } from "@/lib/alegra-contacts-webhook"
import type { TenantConfig } from "@/lib/tenants"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Avisos de Alegra aplicados al espejo, contra Postgres real (crm_test) y Alegra MOCKEADO
 * (fetch stubeado: ninguna llamada sale a la red). Como el formato del aviso no está
 * documentado, se prueban las formas razonables. Datos inventados.
 */

const TENANT = "tenant-a"
const config = {
  id: TENANT,
  alegraMock: false,
  alegraEmail: "api@plataforma.example",
  alegraToken: "token-de-prueba",
} as unknown as TenantConfig

type Raw = Record<string, unknown>
const contacto = (id: number, extra: Raw = {}): Raw => ({
  id,
  name: `Cliente ${id}`,
  status: "active",
  type: ["client"],
  ...extra,
})

const fetchMock = vi.fn()
const pedidos = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)

/** Alegra responde GET /contacts/{id} con `porId[id]`, o 404. */
function alegraTiene(porId: Record<string, Raw>) {
  fetchMock.mockImplementation(async (url: string) => {
    const id = new URL(url).pathname.split("/").pop() ?? ""
    const c = porId[id]
    return c ? new Response(JSON.stringify(c), { status: 200 }) : new Response('{"message":"no existe"}', { status: 404 })
  })
}

async function fila(alegraId: string) {
  const [row] = await getDb()
    .select()
    .from(alegraContacts)
    .where(and(eq(alegraContacts.tenantId, TENANT), eq(alegraContacts.alegraId, alegraId)))
  return row
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(TENANT)
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("procesarAvisoContacto", () => {
  it("edit-client con el contacto completo en el cuerpo: upsert directo, 0 requests", async () => {
    await upsertContactos(TENANT, [mapRawContactRow(contacto(42, { name: "Nombre Viejo" }))], "sync")
    const aviso = { subject: "edit-client", message: { client: contacto(42, { name: "Nombre Nuevo", term: { id: 1, days: "30" } }) } }

    expect(await procesarAvisoContacto(config, "edit-client", aviso)).toEqual({ accion: "upsert_directo", id: "42", requests: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await fila("42")).toMatchObject({ name: "Nombre Nuevo", origen: "webhook", status: "active", tipoCuenta: "corriente" })
  })

  it("new-client con solo el id: lo lee por id (1 request) y lo inserta", async () => {
    alegraTiene({ "77": contacto(77, { name: "Alta Nueva SA", phonePrimary: "+54 11 5555-0077" }) })

    expect(await procesarAvisoContacto(config, "new-client", { id: 77 })).toEqual({ accion: "upsert_leido", id: "77", requests: 1 })
    expect(pedidos()).toEqual(["/api/v1/contacts/77"])
    expect(await fila("77")).toMatchObject({ name: "Alta Nueva SA", origen: "webhook", phonesNorm: ["1155550077"] })
  })

  it("un contacto parcial en el cuerpo no se upsertea directo (pisaría con null lo que no trajo)", async () => {
    alegraTiene({ "42": contacto(42, { name: "Completo SA", priceList: { id: 2, name: "Mayorista" } }) })

    const r = await procesarAvisoContacto(config, "edit-client", { message: { client: { id: 42, name: "Completo SA" } } })
    expect(r).toMatchObject({ accion: "upsert_leido", requests: 1 })
    expect(await fila("42")).toMatchObject({ priceListId: "2" })
  })

  it("delete-client con el id del contacto: baja soft sin request", async () => {
    await upsertContactos(TENANT, [mapRawContactRow(contacto(42))], "sync")

    expect(await procesarAvisoContacto(config, "delete-client", { message: { client: { id: "42" } } })).toEqual({
      accion: "baja",
      id: "42",
      requests: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await fila("42")).toMatchObject({ status: "inactive", origen: "webhook", name: "Cliente 42" })
  })

  it("delete-client con un id suelto en la raíz: lo confirma leyendo; si existe, NO lo da de baja", async () => {
    await upsertContactos(TENANT, [mapRawContactRow(contacto(42))], "sync")
    alegraTiene({ "42": contacto(42) })

    expect(await procesarAvisoContacto(config, "delete-client", { id: 42, event: "delete-client" })).toMatchObject({
      accion: "upsert_leido",
      requests: 1,
    })
    expect((await fila("42"))?.status).toBe("active")
  })

  it("delete-client con un id suelto que Alegra ya no tiene: baja", async () => {
    await upsertContactos(TENANT, [mapRawContactRow(contacto(42))], "sync")
    alegraTiene({})

    expect(await procesarAvisoContacto(config, "delete-client", { id: 42 })).toMatchObject({ accion: "baja_404", requests: 1 })
    expect((await fila("42"))?.status).toBe("inactive")
  })

  it("el objeto puede venir como texto JSON dentro del cuerpo", async () => {
    const aviso = { message: JSON.stringify({ client: contacto(5) }) }
    expect(await procesarAvisoContacto(config, "new-client", aviso)).toMatchObject({ accion: "upsert_directo", id: "5" })
    expect(await fila("5")).toBeDefined()
  })

  it("sin id reconocible: no hace nada y no toca Alegra", async () => {
    for (const aviso of [null, "texto", [], { message: { nada: true } }, { id: "../../etc" }]) {
      expect(await procesarAvisoContacto(config, "edit-client", aviso)).toEqual({ accion: "sin_id", requests: 0 })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("Alegra saturado (400 con code 429): error con motivo corto, sin tirar", async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ code: 429, message: "Too many requests" }), { status: 400 }))
      const p = procesarAvisoContacto(config, "edit-client", { id: 42 })
      await vi.runAllTimersAsync()
      expect(await p).toMatchObject({ accion: "error", id: "42", error: "alegra_429" })
      // Pocos reintentos: el primero más 2.
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
