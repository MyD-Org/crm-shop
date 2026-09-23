import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraContacts, notificationRules, tenants } from "@/db/schema"
import { mapRawContactRow } from "@/lib/alegra"
import { upsertContactos } from "@/lib/alegra-contacts-repo"
import type { TenantConfig } from "@/lib/tenants"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Fachada de contactos (lib/contactos.ts) contra Postgres real (crm_test). Las funciones en
 * vivo de Alegra están mockeadas con contador: cada test dice cuántas requests gastó. Datos
 * inventados (CUITs de mentira, dominios .example).
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

import {
  buscarPorTelefono,
  buscarPorTexto,
  clientesActivos,
  contactoPorDocumento,
  contactoPorId,
  crearContacto,
} from "@/lib/contactos"

const TENANT = "tenant-a"
const OTRO = "tenant-b"
const config = { id: TENANT, alegraMock: false, alegraToken: "token-de-prueba" } as unknown as TenantConfig

type Raw = Record<string, unknown>
const contacto = (id: number | string, extra: Raw = {}): Raw => ({
  id,
  name: `Cliente ${id}`,
  status: "active",
  type: ["client"],
  ...extra,
})

async function espejo(raws: Raw[], tenant = TENANT) {
  await upsertContactos(tenant, raws.map(mapRawContactRow), "sync")
}

const llamadasEnVivo = () =>
  vivo.getContactRaw.mock.calls.length +
  vivo.findContactRawByIdentifier.mock.calls.length +
  vivo.searchContactsRaw.mock.calls.length +
  vivo.createContactRaw.mock.calls.length

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
  await seedTenant(OTRO)
  for (const f of Object.values(vivo)) f.mockReset()
  vivo.getContactRaw.mockResolvedValue(null)
  vivo.findContactRawByIdentifier.mockResolvedValue(null)
  vivo.searchContactsRaw.mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("buscarPorTelefono (bot ?phone=)", () => {
  it("encuentra el contacto aunque el formato guardado sea otro, sin tocar Alegra", async () => {
    await espejo([contacto(1, { name: "Iluminación Ejemplo SRL", mobile: "+54 9 11 5555-0001" })])
    const r = await buscarPorTelefono(config, "5491155550001")
    expect(r.map((c) => c.alegraId)).toEqual(["1"])
    expect(r[0].phone).toBe("+54 9 11 5555-0001")
    expect(llamadasEnVivo()).toBe(0)
  })

  it("sin coincidencia: vacío y 0 requests (no hay fallback: sería el padrón)", async () => {
    await espejo([contacto(1, { phonePrimary: "011 4444-0000" })])
    expect(await buscarPorTelefono(config, "5491155550001")).toEqual([])
    expect(llamadasEnVivo()).toBe(0)
  })

  it("dos contactos con el mismo teléfono: devuelve los dos (caso ambiguo)", async () => {
    await espejo([
      contacto(1, { phonePrimary: "+54 223 555-0112" }),
      contacto(2, { phoneSecondary: "0223 555 0112" }),
    ])
    expect((await buscarPorTelefono(config, "5492235550112")).map((c) => c.alegraId)).toEqual(["1", "2"])
  })

  it("no devuelve cuentas internas, ni filas inactivas, ni de otro tenant", async () => {
    await espejo([
      contacto(1, { name: "Stock general", phonePrimary: "+54 223 555-0112" }),
      contacto(2, { name: "Constructora Delta SA", phonePrimary: "+54 223 555-0112" }),
      contacto(3, { phonePrimary: "+54 223 555-0112" }),
    ])
    await espejo([contacto(4, { phonePrimary: "+54 223 555-0112" })], OTRO)
    await getDb().update(alegraContacts).set({ status: "inactive" }).where(eq(alegraContacts.alegraId, "3"))
    expect((await buscarPorTelefono(config, "5492235550112")).map((c) => c.name)).toEqual(["Constructora Delta SA"])
  })

  it("un teléfono que no identifica una línea no matchea contactos sin teléfono", async () => {
    await espejo([contacto(1)])
    expect(await buscarPorTelefono(config, "123")).toEqual([])
  })
})

describe("buscarPorTexto (bot ?q=)", () => {
  it("nombre sin tildes encuentra el nombre con tildes", async () => {
    await espejo([contacto(1, { name: "Iluminación Ejemplo SRL" }), contacto(2, { name: "Otra Casa" })])
    const r = await buscarPorTexto(config, "iluminacion ejemplo")
    expect(r.map((c) => c.name)).toEqual(["Iluminación Ejemplo SRL"])
    expect(llamadasEnVivo()).toBe(0)
  })

  it("CUIT con guiones encuentra la identificación cargada solo con dígitos", async () => {
    await espejo([contacto(1, { identification: "20123456789" })])
    expect((await buscarPorTexto(config, "20-12345678-9")).map((c) => c.alegraId)).toEqual(["1"])
    expect(llamadasEnVivo()).toBe(0)
  })

  it("los comodines de LIKE se buscan literales", async () => {
    await espejo([contacto(1, { name: "Casa Uno" })])
    vivo.searchContactsRaw.mockResolvedValue([])
    expect(await buscarPorTexto(config, "%")).toEqual([])
  })

  it("sin resultados en el espejo: 1 request a ?query= y lo que trae queda en el espejo", async () => {
    vivo.searchContactsRaw.mockResolvedValue([contacto(9, { name: "Recién Cargado SA" })])
    const r = await buscarPorTexto(config, "recien cargado")
    expect(r.map((c) => c.alegraId)).toEqual(["9"])
    expect(vivo.searchContactsRaw).toHaveBeenCalledTimes(1)
    expect((await fila("9"))?.origen).toBe("fallback")
    // La segunda vez ya está en el espejo.
    await buscarPorTexto(config, "recien cargado")
    expect(vivo.searchContactsRaw).toHaveBeenCalledTimes(1)
  })
})

describe("contactoPorDocumento (login del portal)", () => {
  it("documento cargado con guiones en Alegra matchea los dígitos, sin requests", async () => {
    await espejo([contacto(1, { identification: "20-12345678-9", email: "compras@cliente.example" })])
    const c = await contactoPorDocumento(config, "20123456789")
    expect(c).toMatchObject({ alegraId: "1", email: "compras@cliente.example" })
    expect(llamadasEnVivo()).toBe(0)
  })

  it("documento repetido: gana el cliente sobre el proveedor, y después el id menor", async () => {
    await espejo([
      contacto(5, { identification: "20123456789", type: ["provider"] }),
      contacto(12, { identification: "20123456789" }),
      contacto(9, { identification: "20123456789" }),
    ])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    // Numérico: 9 < 12 (como texto "12" iría primero).
    expect((await contactoPorDocumento(config, "20123456789"))?.alegraId).toBe("9")
    // Solo el conteo en el log, nunca el documento.
    expect(warn.mock.calls.flat().join(" ")).not.toContain("20123456789")
  })

  it("documento inexistente: 1 llamada al buscador en vivo acotado y null", async () => {
    expect(await contactoPorDocumento(config, "20999999998")).toBeNull()
    expect(vivo.findContactRawByIdentifier).toHaveBeenCalledTimes(1)
    expect(vivo.findContactRawByIdentifier).toHaveBeenCalledWith(config, "20999999998")
  })

  it("miss que Alegra sí tiene: lo guarda y la próxima vez sale del espejo", async () => {
    vivo.findContactRawByIdentifier.mockResolvedValue(contacto(7, { identification: "27111111114" }))
    expect((await contactoPorDocumento(config, "27111111114"))?.alegraId).toBe("7")
    expect((await contactoPorDocumento(config, "27111111114"))?.alegraId).toBe("7")
    expect(vivo.findContactRawByIdentifier).toHaveBeenCalledTimes(1)
  })
})

describe("contactoPorId (portal)", () => {
  it("id que no está: 1 request, upsert, y la segunda lectura 0", async () => {
    vivo.getContactRaw.mockResolvedValue(contacto(42))
    expect((await contactoPorId(config, "42"))?.alegraId).toBe("42")
    expect((await contactoPorId(config, "42"))?.alegraId).toBe("42")
    expect(vivo.getContactRaw).toHaveBeenCalledTimes(1)
  })

  it("fila inactiva: cae al fallback y la reactiva", async () => {
    await espejo([contacto(42)])
    await getDb().update(alegraContacts).set({ status: "inactive" }).where(eq(alegraContacts.alegraId, "42"))
    vivo.getContactRaw.mockResolvedValue(contacto(42, { name: "Nombre Nuevo" }))
    expect((await contactoPorId(config, "42"))?.name).toBe("Nombre Nuevo")
    expect(await fila("42")).toMatchObject({ status: "active", origen: "fallback" })
  })

  it("404 en Alegra: null", async () => {
    expect(await contactoPorId(config, "404")).toBeNull()
    expect(vivo.getContactRaw).toHaveBeenCalledTimes(1)
  })

  it("un error de Alegra se propaga (no se lee como 'no existe')", async () => {
    vivo.getContactRaw.mockRejectedValue(new Error("caído"))
    await expect(contactoPorId(config, "42")).rejects.toThrow("caído")
  })

  it("tipoCuenta sale de la columna generada: plazo 0 + límite 50000 → corriente", async () => {
    await espejo([
      contacto(1, { term: { id: 1, name: "De contado", days: "0" }, creditLimit: 50000 }),
      contacto(2, { term: { id: 1, name: "De contado", days: "" } }),
      contacto(3, { term: { id: 2, name: "30 días", days: "30" } }),
    ])
    expect((await contactoPorId(config, "1"))?.tipoCuenta).toBe("corriente")
    expect((await contactoPorId(config, "2"))?.tipoCuenta).toBe("contado")
    expect((await contactoPorId(config, "3"))?.tipoCuenta).toBe("corriente")
    expect(llamadasEnVivo()).toBe(0)
  })

  it("devuelve la forma de siempre (la que armaba mapRawContact en vivo)", async () => {
    await espejo([
      contacto(1, {
        name: "Iluminación Ejemplo SRL",
        identification: { type: "CUIT", number: "20-12345678-9" },
        email: "compras@cliente.example",
        mobile: "+54 9 11 5555-0001",
        priceList: { id: 2, name: "Mayorista", status: "active" },
        seller: { id: 3, name: "Vendedora Ejemplo" },
        term: { id: 4, name: "15 días", days: "15" },
        creditLimit: "100000",
      }),
    ])
    expect(await contactoPorId(config, "1")).toMatchObject({
      alegraId: "1",
      name: "Iluminación Ejemplo SRL",
      identification: "20-12345678-9",
      email: "compras@cliente.example",
      phone: "+54 9 11 5555-0001",
      priceListId: "2",
      priceListName: "Mayorista",
      priceListStatus: "active",
      sellerId: "3",
      sellerName: "Vendedora Ejemplo",
      paymentTermId: "4",
      paymentTermName: "15 días",
      paymentTermDays: 15,
      creditLimit: 100000,
      status: "active",
      tipoCuenta: "corriente",
      types: ["client"],
    })
  })
})

describe("clientesActivos (cobranza)", () => {
  it("solo activos del espejo y de Alegra, del tenant, sin requests", async () => {
    await espejo([contacto(1), contacto(2, { status: "inactive" }), contacto(3)])
    await espejo([contacto(4)], OTRO)
    await getDb().update(alegraContacts).set({ status: "inactive" }).where(eq(alegraContacts.alegraId, "3"))
    expect((await clientesActivos(config)).map((c) => c.alegraId)).toEqual(["1"])
    expect(llamadasEnVivo()).toBe(0)
  })

  it("espejo vacío: vacío, aviso en el log y ningún recorrido en vivo", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await clientesActivos(config)).toEqual([])
    expect(warn.mock.calls.flat().join(" ")).toContain("espejo_vacio")
    expect(llamadasEnVivo()).toBe(0)
  })
})

describe("crearContacto (bot POST)", () => {
  it("write-through: el bot lo encuentra por teléfono enseguida", async () => {
    vivo.createContactRaw.mockResolvedValue(contacto(77, { name: "Nuevo Cliente SA", phonePrimary: "+54 11 5555-0077" }))
    const c = await crearContacto(config, { name: "Nuevo Cliente SA", phone: "+54 11 5555-0077" })
    expect(c.alegraId).toBe("77")
    expect((await fila("77"))?.origen).toBe("write_through")
    expect((await buscarPorTelefono(config, "541155550077")).map((x) => x.alegraId)).toEqual(["77"])
    expect(vivo.createContactRaw).toHaveBeenCalledTimes(1)
  })

  it("si la base falla, devuelve igual el contacto creado y no reintenta Alegra", async () => {
    vivo.createContactRaw.mockResolvedValue(contacto(78, { name: "Otro SA", phonePrimary: "+54 11 5555-0078" }))
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    // Tenant inexistente → la FK del insert falla.
    const sinTenant = { ...config, id: "tenant-inexistente" } as TenantConfig
    const c = await crearContacto(sinTenant, { name: "Otro SA" })
    expect(c).toMatchObject({ alegraId: "78", name: "Otro SA", phone: "+54 11 5555-0078" })
    expect(vivo.createContactRaw).toHaveBeenCalledTimes(1)
    // Sin datos del contacto en el log.
    expect(err.mock.calls.flat().join(" ")).not.toContain("Otro SA")
  })
})

describe("notificaciones sobre el espejo", () => {
  const fetchMock = vi.fn()

  beforeEach(async () => {
    await getDb().update(tenants).set({ alegraToken: "token-de-prueba", alegraEmail: "api@plataforma.example" }).where(eq(tenants.id, TENANT))
    await getDb().insert(notificationRules).values({ tenantId: TENANT, channels: ["email"] })
    fetchMock.mockReset()
    // Alegra (solo /invoices debería llamarse): sin facturas.
    fetchMock.mockImplementation(async () => new Response("[]", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
  })

  const pathsPedidos = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)

  it("lee los clientes del espejo: ninguna request a /contacts", async () => {
    await espejo([contacto(1, { email: "a@cliente.example" }), contacto(2, { email: "b@cliente.example" })])
    const { runNotifications } = await import("@/lib/notifications")
    const r = await runNotifications({ tenantId: TENANT })
    expect(r.failed).toBe(0)
    expect(pathsPedidos().some((p) => p.includes("/contacts"))).toBe(false)
    // Las facturas de cada cliente del espejo sí se leen en vivo (eso no cambia).
    expect(pathsPedidos().some((p) => p.endsWith("/invoices"))).toBe(true)
  })

  it("espejo vacío: no notifica, deja el motivo y no toca Alegra", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { runNotifications } = await import("@/lib/notifications")
    const r = await runNotifications({ tenantId: TENANT })
    expect(r).toMatchObject({ sent: 0, failed: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().join(" ")).toContain("espejo_vacio")
  })
})
