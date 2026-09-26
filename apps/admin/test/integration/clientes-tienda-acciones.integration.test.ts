import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraContacts, contactosAccesoFacturacion } from "@/db/schema"
import { shopClientLinks } from "@/db/shop-schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import {
  buscarContactosParaVincular,
  desvincularUsuario,
  otorgarAcceso,
  quitarAcceso,
  vincularUsuario,
} from "@/lib/clientes-tienda-acciones"
import { listarClientesTienda } from "@/lib/clientes-tienda-repo"
import { seedClientLink, seedOperator, seedShopCliente, seedTenant, truncateAll } from "./helpers"

// Acciones de "Clientes de la tienda" (R4a de clientes-tienda-admin): excepción de acceso a
// Facturación por contacto y vincular/desvincular usuarios desde el admin. Lógica + API contra
// crm_test aislada (esquema `shop` de las migraciones REALES del Shop, 0019 incluida).
// Sesión mockeada igual que clientes-tienda-admin. Datos inventados, mails @cliente.example.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
vi.mock("@/lib/clientes-tienda-acciones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/clientes-tienda-acciones")>()
  return { ...real, otorgarAcceso: vi.fn(real.otorgarAcceso), vincularUsuario: vi.fn(real.vincularUsuario) }
})

const vinculoRoute = await import("@/app/api/admin/clientes-tienda/[clerkUserId]/vinculo/route")
const accesoRoute = await import("@/app/api/admin/contactos-alegra/[alegraId]/acceso-facturacion/route")
const buscarRoute = await import("@/app/api/admin/contactos-alegra/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"
const ACTOR = { id: "00000000-0000-4000-8000-0000000000aa", name: "Admin Ejemplo" }

type FilaContacto = typeof alegraContacts.$inferInsert

async function seedContacto(
  tenantId: string,
  alegraId: string,
  opts: { name?: string; corriente?: boolean; status?: string; extra?: Partial<FilaContacto> } = {},
) {
  await getDb()
    .insert(alegraContacts)
    .values({
      tenantId,
      alegraId,
      name: opts.name ?? `Contacto ${alegraId}`,
      types: ["client"],
      paymentTermDays: opts.corriente ? 30 : 0,
      status: opts.status ?? "active",
      ...opts.extra,
    })
}

const linksDe = (clerkUserId: string) =>
  getDb().select().from(shopClientLinks).where(eq(shopClientLinks.clerkUserId, clerkUserId))

const excepcionesDe = (tenantId: string, alegraId: string) =>
  getDb()
    .select()
    .from(contactosAccesoFacturacion)
    .where(and(eq(contactosAccesoFacturacion.tenantId, tenantId), eq(contactosAccesoFacturacion.alegraId, alegraId)))

function logsDe(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((c) => c.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")).join("\n")
}

describe("clientes de la tienda: acciones (lógica)", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
  })

  afterAll(async () => {
    await truncateAll()
  })

  describe("buscarContactosParaVincular", () => {
    beforeEach(async () => {
      await seedContacto(TENANT_A, "101", {
        name: "Luminarias del Sur SA",
        corriente: true,
        extra: { identification: "30-71111111-0", identificationNorm: "30711111110", email: "compras@cliente.example", emailsNorm: ["compras@cliente.example", "ana@cliente.example"] },
      })
      await seedContacto(TENANT_A, "102", { name: "Luces Norte SRL" })
      await seedContacto(TENANT_A, "103", { name: "Luminarias Inactivas", status: "inactive" })
      await seedContacto(TENANT_A, "104", { name: "Luminarias Proveedor", extra: { types: ["provider"] } })
      await seedContacto(TENANT_A, "105", { name: "Luminarias Secundaria", extra: { alegraAccount: "secundaria" } })
      await seedContacto(TENANT_B, "106", { name: "Luminarias de Otro Tenant" })
    })

    it("por nombre: sólo clientes activos de la cuenta principal del tenant", async () => {
      const r = await buscarContactosParaVincular(TENANT_A, "lumin")
      expect(r.map((c) => c.alegraId)).toEqual(["101"])
      expect(r[0]).toEqual({
        alegraId: "101",
        nombre: "Luminarias del Sur SA",
        identificacion: "30-71111111-0",
        email: "compras@cliente.example",
        tipoCuenta: "corriente",
        acceso: true,
      })
    })

    it("por CUIT (desde 3 dígitos, con o sin guiones) y por email de cualquier persona asociada", async () => {
      expect((await buscarContactosParaVincular(TENANT_A, "30-711")).map((c) => c.alegraId)).toEqual(["101"])
      expect((await buscarContactosParaVincular(TENANT_A, "ANA@cliente")).map((c) => c.alegraId)).toEqual(["101"])
    })

    it("comodines literales y límite de 10 ordenado por nombre", async () => {
      expect(await buscarContactosParaVincular(TENANT_A, "%")).toEqual([])
      for (let i = 0; i < 12; i++) await seedContacto(TENANT_A, `2${String(i).padStart(2, "0")}`, { name: `Serie ${String(i).padStart(2, "0")}` })
      const r = await buscarContactosParaVincular(TENANT_A, "serie")
      expect(r).toHaveLength(10)
      expect(r[0].nombre).toBe("Serie 00")
    })
  })

  describe("vincularUsuario", () => {
    beforeEach(async () => {
      await seedShopCliente(TENANT_A, { clerkUserId: "user_a1" })
      await seedContacto(TENANT_A, "101", {
        name: "Luminarias del Sur SA",
        corriente: true,
        extra: { identification: "30711111110", priceListId: "7", priceListStatus: "active" },
      })
      await seedContacto(TENANT_A, "102", { name: "Luces Norte SRL", extra: { priceListId: "9", priceListStatus: "inactive" } })
    })

    it("crea el vínculo activo, método operador, snapshot del contacto y auditoría", async () => {
      const r = await vincularUsuario(TENANT_A, "user_a1", "101", ACTOR)
      expect(r).toMatchObject({ kind: "ok", cambio: true, razonSocial: "Luminarias del Sur SA" })
      const [l] = await linksDe("user_a1")
      expect(l).toMatchObject({
        alegraContactId: "101",
        razonSocial: "Luminarias del Sur SA",
        cuit: "30711111110",
        idPriceList: "7",
        tipoCuenta: "corriente",
        estado: "activa",
        metodo: "operador",
        vinculadoPor: ACTOR.id,
        vinculadoPorNombre: ACTOR.name,
        revokedAt: null,
      })
    })

    it("lista de precios dada de baja en Alegra ⇒ id_price_list null (principal), como el Shop", async () => {
      await vincularUsuario(TENANT_A, "user_a1", "102", ACTOR)
      const [l] = await linksDe("user_a1")
      expect(l.idPriceList).toBeNull()
      expect(l.tipoCuenta).toBe("contado")
    })

    it("mismo contacto otra vez ⇒ ok sin cambios (idempotente)", async () => {
      await vincularUsuario(TENANT_A, "user_a1", "101", ACTOR)
      expect(await vincularUsuario(TENANT_A, "user_a1", "101", ACTOR)).toMatchObject({ kind: "ok", cambio: false })
      expect(await linksDe("user_a1")).toHaveLength(1)
    })

    it("vínculo activo a otro contacto ⇒ ya_vinculado con la razón social, y nada cambia", async () => {
      await vincularUsuario(TENANT_A, "user_a1", "101", ACTOR)
      expect(await vincularUsuario(TENANT_A, "user_a1", "102", ACTOR)).toEqual({
        kind: "ya_vinculado",
        razonSocial: "Luminarias del Sur SA",
      })
      const links = await linksDe("user_a1")
      expect(links.map((l) => l.alegraContactId)).toEqual(["101"])
    })

    it("contacto proveedor, inactivo, de otra cuenta, de otro tenant o inexistente ⇒ contacto_invalido", async () => {
      await seedContacto(TENANT_A, "201", { extra: { types: ["provider"] } })
      await seedContacto(TENANT_A, "202", { status: "inactive" })
      await seedContacto(TENANT_A, "203", { extra: { alegraAccount: "secundaria" } })
      await seedContacto(TENANT_B, "204")
      for (const id of ["201", "202", "203", "204", "999"]) {
        expect(await vincularUsuario(TENANT_A, "user_a1", id, ACTOR)).toEqual({ kind: "contacto_invalido" })
      }
      expect(await linksDe("user_a1")).toHaveLength(0)
    })

    it("usuario de otro tenant, eliminado o inexistente ⇒ not_found", async () => {
      await seedShopCliente(TENANT_B, { clerkUserId: "user_b1" })
      await seedShopCliente(TENANT_A, { clerkUserId: "user_baja", email: null, emailNorm: null, nombre: null, eliminadoEn: new Date() })
      for (const u of ["user_b1", "user_baja", "user_nadie"]) {
        expect(await vincularUsuario(TENANT_A, u, "101", ACTOR)).toEqual({ kind: "not_found" })
      }
      expect(await linksDe("user_b1")).toHaveLength(0)
    })

    it("con una fila previa sin_coincidencia, el vínculo nuevo prevalece en el listado", async () => {
      await seedClientLink("user_a1", { estado: "sin_coincidencia", alegraContactId: "ambiguo", razonSocial: null })
      expect(await vincularUsuario(TENANT_A, "user_a1", "101", ACTOR)).toMatchObject({ kind: "ok", cambio: true })
      const { items } = await listarClientesTienda(TENANT_A)
      expect(items[0].vinculo).toMatchObject({ estado: "vinculado", metodo: "operador", alegraContactId: "101" })
    })

    it("dos vincular simultáneos ⇒ a lo sumo un vínculo activo", async () => {
      const rs = await Promise.all([
        vincularUsuario(TENANT_A, "user_a1", "101", ACTOR),
        vincularUsuario(TENANT_A, "user_a1", "102", ACTOR),
      ])
      const kinds = rs.map((r) => r.kind).sort()
      expect(kinds).toEqual(["ok", "ya_vinculado"])
      const activos = (await linksDe("user_a1")).filter((l) => l.estado === "activa")
      expect(activos).toHaveLength(1)
    })

    it("log sin emails ni razones sociales", async () => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {})
      await vincularUsuario(TENANT_A, "user_a1", "101", ACTOR)
      const logs = logsDe(info)
      info.mockRestore()
      expect(logs).toContain("shop_cliente_vinculado")
      expect(logs).not.toContain("@")
      expect(logs).not.toContain("Luminarias")
    })
  })

  describe("desvincularUsuario", () => {
    beforeEach(async () => {
      await seedShopCliente(TENANT_A, { clerkUserId: "user_a1" })
      await seedContacto(TENANT_A, "101", { name: "Luminarias del Sur SA" })
    })

    it("revoca el activo con quién y cuándo, sin borrar", async () => {
      await vincularUsuario(TENANT_A, "user_a1", "101", ACTOR)
      const otro = { id: "00000000-0000-4000-8000-0000000000bb", name: "Otra Admin" }
      expect(await desvincularUsuario(TENANT_A, "user_a1", otro)).toEqual({ kind: "ok", cambio: true })
      const links = await linksDe("user_a1")
      expect(links).toHaveLength(1)
      expect(links[0]).toMatchObject({
        estado: "revocada",
        revocadoPor: otro.id,
        revocadoPorNombre: otro.name,
        vinculadoPor: ACTOR.id,
      })
      expect(links[0].revokedAt).toBeInstanceOf(Date)
      const { items } = await listarClientesTienda(TENANT_A)
      expect(items[0].vinculo.estado).toBe("revocado")
    })

    it("sin vínculo activo ⇒ ok sin cambios; usuario ajeno ⇒ not_found", async () => {
      expect(await desvincularUsuario(TENANT_A, "user_a1", ACTOR)).toEqual({ kind: "ok", cambio: false })
      await seedShopCliente(TENANT_B, { clerkUserId: "user_b1" })
      await seedClientLink("user_b1")
      expect(await desvincularUsuario(TENANT_A, "user_b1", ACTOR)).toEqual({ kind: "not_found" })
      expect((await linksDe("user_b1"))[0].estado).toBe("activa")
    })

    it("después se puede volver a vincular (el índice parcial admite revocadas en el historial)", async () => {
      await vincularUsuario(TENANT_A, "user_a1", "101", ACTOR)
      await desvincularUsuario(TENANT_A, "user_a1", ACTOR)
      expect(await vincularUsuario(TENANT_A, "user_a1", "101", ACTOR)).toMatchObject({ kind: "ok", cambio: true })
      expect(await linksDe("user_a1")).toHaveLength(2)
    })
  })

  describe("otorgarAcceso / quitarAcceso", () => {
    beforeEach(async () => {
      await seedContacto(TENANT_A, "301", { name: "Contado SA" })
      await seedContacto(TENANT_A, "302", { name: "Corriente SA", corriente: true })
    })

    it("otorgar a un contado ⇒ vigente con quién; la vista informa acceso", async () => {
      expect(await otorgarAcceso(TENANT_A, "301", ACTOR)).toEqual({ kind: "ok", cambio: true })
      const [e] = await excepcionesDe(TENANT_A, "301")
      expect(e).toMatchObject({ alegraAccount: "principal", otorgadoPor: ACTOR.id, otorgadoPorNombre: ACTOR.name, revocadoEn: null })
      const [v] = (await getDb().execute(
        sql`SELECT acceso_facturacion FROM alegra_contacts_shop WHERE tenant_id = ${TENANT_A} AND alegra_id = '301'`,
      )) as unknown as { acceso_facturacion: boolean }[]
      expect(v.acceso_facturacion).toBe(true)
    })

    it("otorgar dos veces ⇒ ok sin cambios y una sola vigente", async () => {
      await otorgarAcceso(TENANT_A, "301", ACTOR)
      expect(await otorgarAcceso(TENANT_A, "301", ACTOR)).toEqual({ kind: "ok", cambio: false })
      expect(await excepcionesDe(TENANT_A, "301")).toHaveLength(1)
    })

    it("cuenta corriente ⇒ es_cuenta_corriente sin escribir", async () => {
      expect(await otorgarAcceso(TENANT_A, "302", ACTOR)).toEqual({ kind: "es_cuenta_corriente" })
      expect(await excepcionesDe(TENANT_A, "302")).toHaveLength(0)
    })

    it("contacto ajeno, inactivo, proveedor o inexistente ⇒ contacto_invalido sin escribir", async () => {
      await seedContacto(TENANT_B, "303")
      await seedContacto(TENANT_A, "304", { status: "inactive" })
      await seedContacto(TENANT_A, "305", { extra: { types: ["provider"] } })
      for (const id of ["303", "304", "305", "999"]) {
        expect(await otorgarAcceso(TENANT_A, id, ACTOR)).toEqual({ kind: "contacto_invalido" })
      }
      expect(await excepcionesDe(TENANT_B, "303")).toHaveLength(0)
    })

    it("quitar revoca sin borrar y conserva el historial; sin vigente ⇒ ok sin cambios", async () => {
      await otorgarAcceso(TENANT_A, "301", ACTOR)
      const otro = { id: "00000000-0000-4000-8000-0000000000bb", name: "Otra Admin" }
      expect(await quitarAcceso(TENANT_A, "301", otro)).toEqual({ kind: "ok", cambio: true })
      expect(await quitarAcceso(TENANT_A, "301", otro)).toEqual({ kind: "ok", cambio: false })
      await otorgarAcceso(TENANT_A, "301", ACTOR)
      await quitarAcceso(TENANT_A, "301", otro)
      const hist = await excepcionesDe(TENANT_A, "301")
      expect(hist).toHaveLength(2)
      for (const e of hist) {
        expect(e).toMatchObject({ revocadoPor: otro.id, revocadoPorNombre: otro.name })
        expect(e.revocadoEn).toBeInstanceOf(Date)
      }
    })

    it("quitar no toca la excepción de otro tenant", async () => {
      await seedContacto(TENANT_B, "301")
      await otorgarAcceso(TENANT_B, "301", ACTOR)
      expect(await quitarAcceso(TENANT_A, "301", ACTOR)).toEqual({ kind: "ok", cambio: false })
      expect((await excepcionesDe(TENANT_B, "301"))[0].revocadoEn).toBeNull()
    })

    it("logs sin razón social", async () => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {})
      await otorgarAcceso(TENANT_A, "301", ACTOR)
      await quitarAcceso(TENANT_A, "301", ACTOR)
      const logs = logsDe(info)
      info.mockRestore()
      expect(logs).toContain("acceso_facturacion_otorgado")
      expect(logs).toContain("acceso_facturacion_quitado")
      expect(logs).not.toContain("Contado SA")
      expect(logs).not.toContain("@")
    })
  })

  describe("listado con la excepción (lee la vista)", () => {
    it("contado + excepción vigente ⇒ acceso 'excepcion' y excepcionVigente; corriente ⇒ 'corriente'", async () => {
      await seedShopCliente(TENANT_A, { clerkUserId: "user_ex" })
      await seedShopCliente(TENANT_A, { clerkUserId: "user_cc" })
      await seedContacto(TENANT_A, "301", { name: "Contado SA" })
      await seedContacto(TENANT_A, "302", { name: "Corriente SA", corriente: true })
      await seedClientLink("user_ex", { alegraContactId: "301" })
      await seedClientLink("user_cc", { alegraContactId: "302" })
      await otorgarAcceso(TENANT_A, "301", ACTOR)
      const { items } = await listarClientesTienda(TENANT_A)
      const ex = items.find((i) => i.clerkUserId === "user_ex")
      const cc = items.find((i) => i.clerkUserId === "user_cc")
      expect(ex).toMatchObject({ acceso: "excepcion", excepcionVigente: true, tipoCuenta: "contado" })
      expect(cc).toMatchObject({ acceso: "corriente", excepcionVigente: false })
      expect((await listarClientesTienda(TENANT_A, { acceso: "con" })).total).toBe(2)
      await quitarAcceso(TENANT_A, "301", ACTOR)
      const despues = (await listarClientesTienda(TENANT_A)).items.find((i) => i.clerkUserId === "user_ex")
      expect(despues).toMatchObject({ acceso: "no", excepcionVigente: false })
    })

    it("contacto inactivo con excepción vigente ⇒ acceso 'no' (fail-closed) pero la excepción se ve", async () => {
      await seedShopCliente(TENANT_A, { clerkUserId: "user_in" })
      await seedContacto(TENANT_A, "301")
      await seedClientLink("user_in", { alegraContactId: "301" })
      await otorgarAcceso(TENANT_A, "301", ACTOR)
      await getDb().update(alegraContacts).set({ status: "inactive" }).where(eq(alegraContacts.alegraId, "301"))
      const { items } = await listarClientesTienda(TENANT_A)
      expect(items[0]).toMatchObject({ acceso: "no", excepcionVigente: true, tipoCuenta: null })
      expect((await listarClientesTienda(TENANT_A, { acceso: "sin" })).total).toBe(1)
    })
  })
})

// ───────────────────────────── API ─────────────────────────────

function login(userId: string, role = "admin") {
  session = { userId, role, tenantId: TENANT_A, name: "Nombre De Cookie", email: "cookie@example.com", save: async () => {} }
}

const req = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://${TENANT_A}.localhost${path}`, {
    method,
    headers: { host: `${TENANT_A}.localhost`, "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  })

const ctxUsuario = (clerkUserId: string) => ({ params: Promise.resolve({ clerkUserId }) })
const ctxContacto = (alegraId: string) => ({ params: Promise.resolve({ alegraId }) })

const vincular = (u: string, body: unknown) =>
  vinculoRoute.POST(req(`/api/admin/clientes-tienda/${u}/vinculo`, "POST", body), ctxUsuario(u))
const desvincular = (u: string) =>
  vinculoRoute.DELETE(req(`/api/admin/clientes-tienda/${u}/vinculo`, "DELETE"), ctxUsuario(u))
const otorgar = (id: string) =>
  accesoRoute.POST(req(`/api/admin/contactos-alegra/${id}/acceso-facturacion`, "POST"), ctxContacto(id))
const quitar = (id: string) =>
  accesoRoute.DELETE(req(`/api/admin/contactos-alegra/${id}/acceso-facturacion`, "DELETE"), ctxContacto(id))
const buscar = (q: string) => buscarRoute.GET(req(`/api/admin/contactos-alegra?q=${encodeURIComponent(q)}`))

const NO_ENCONTRADO = { error: "No encontrado", code: "not_found" }

describe("clientes de la tienda: API de acciones", () => {
  let adminA: string

  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    adminA = await seedOperator(TENANT_A, { role: "admin", name: "Admin Ejemplo" })
    invalidateTenantRegistry()
    login(adminA)
    await seedShopCliente(TENANT_A, { clerkUserId: "user_a1" })
    await seedContacto(TENANT_A, "101", { name: "Luminarias del Sur SA" })
    await seedContacto(TENANT_A, "102", { name: "Luces Norte SRL" })
    await seedContacto(TENANT_A, "103", { name: "Corriente SA", corriente: true })
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("operador ⇒ el 404 del guard en las cinco acciones, y nada cambia", async () => {
    login(await seedOperator(TENANT_A, { role: "operator" }), "operator")
    const respuestas = [
      await vincular("user_a1", { alegraContactId: "101" }),
      await desvincular("user_a1"),
      await otorgar("101"),
      await quitar("101"),
      await buscar("lumin"),
    ]
    for (const res of respuestas) {
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual(NO_ENCONTRADO)
    }
    expect(await linksDe("user_a1")).toHaveLength(0)
    expect(await excepcionesDe(TENANT_A, "101")).toHaveLength(0)
  })

  it("sin sesión ⇒ 401", async () => {
    session = {}
    expect((await otorgar("101")).status).toBe(401)
    expect((await vincular("user_a1", { alegraContactId: "101" })).status).toBe(401)
  })

  it("superadmin también puede", async () => {
    login(await seedOperator(TENANT_A, { role: "superadmin" }), "superadmin")
    expect((await otorgar("101")).status).toBe(200)
  })

  describe("vínculo", () => {
    it("POST vincula con el actor de la sesión (fila fresca) y responde no cacheable", async () => {
      const res = await vincular("user_a1", { alegraContactId: "101" })
      expect(res.status).toBe(200)
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      expect(await res.json()).toEqual({ cambio: true, razonSocial: "Luminarias del Sur SA" })
      const [l] = await linksDe("user_a1")
      expect(l).toMatchObject({ metodo: "operador", vinculadoPor: adminA, vinculadoPorNombre: "Admin Ejemplo" })
    })

    it("otro vínculo activo ⇒ 409 con la razón social", async () => {
      await vincular("user_a1", { alegraContactId: "101" })
      const res = await vincular("user_a1", { alegraContactId: "102" })
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({
        error: "El usuario ya está vinculado a Luminarias del Sur SA. Desvincúlelo antes de vincularlo a otro cliente.",
        code: "ya_vinculado",
      })
    })

    it("contacto inválido ⇒ 422", async () => {
      const res = await vincular("user_a1", { alegraContactId: "999" })
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({
        error: "El cliente seleccionado no existe o no está activo en Alegra.",
        code: "contacto_invalido",
      })
    })

    it.each([
      ["sin body", undefined],
      ["JSON roto", "{no"],
      ["sin alegraContactId", {}],
      ["id no string", { alegraContactId: 101 }],
      ["id con formato inválido", { alegraContactId: "1 OR 1=1" }],
    ])("body inválido (%s) ⇒ 400", async (_caso, body) => {
      const res = await vincular("user_a1", body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "Seleccione un cliente de Alegra.", code: "invalid" })
    })

    it("clerkUserId con formato inválido o de otro tenant ⇒ el mismo 404", async () => {
      await seedShopCliente(TENANT_B, { clerkUserId: "user_b1" })
      for (const u of ["no-es-un-id", "user_b1", "user_inexistente"]) {
        const res = await vincular(u, { alegraContactId: "101" })
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual(NO_ENCONTRADO)
      }
    })

    it("DELETE desvincula; repetir ⇒ 200 sin cambios; usuario ajeno ⇒ 404", async () => {
      await vincular("user_a1", { alegraContactId: "101" })
      const res = await desvincular("user_a1")
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ cambio: true })
      expect(await (await desvincular("user_a1")).json()).toEqual({ cambio: false })
      expect((await desvincular("user_b9")).status).toBe(404)
    })

    it("falla de base ⇒ 500 en usted, sin detalle ni emails en el log", async () => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
      const { vincularUsuario: mockeada } = await import("@/lib/clientes-tienda-acciones")
      vi.mocked(mockeada).mockRejectedValueOnce(Object.assign(new Error("boom a1@cliente.example"), { code: "57P01" }))
      const res = await vincular("user_a1", { alegraContactId: "101" })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: "No se pudo vincular la cuenta. Inténtelo nuevamente.", code: "internal" })
      expect(logsDe(errorLog)).not.toContain("@")
      errorLog.mockRestore()
    })
  })

  describe("acceso a Facturación", () => {
    it("POST otorga; repetir ⇒ 200 sin cambios; DELETE quita", async () => {
      const res = await otorgar("101")
      expect(res.status).toBe(200)
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      expect(await res.json()).toEqual({ cambio: true })
      expect(await (await otorgar("101")).json()).toEqual({ cambio: false })
      const [e] = await excepcionesDe(TENANT_A, "101")
      expect(e).toMatchObject({ otorgadoPor: adminA, otorgadoPorNombre: "Admin Ejemplo" })
      expect(await (await quitar("101")).json()).toEqual({ cambio: true })
      expect(await (await quitar("101")).json()).toEqual({ cambio: false })
    })

    it("cuenta corriente ⇒ 422 es_cuenta_corriente", async () => {
      const res = await otorgar("103")
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({
        error: "Este cliente ya tiene acceso a Facturación por ser cuenta corriente.",
        code: "es_cuenta_corriente",
      })
    })

    it("contacto inexistente ⇒ 422 contacto_invalido; id con formato inválido ⇒ 404", async () => {
      expect((await otorgar("999")).status).toBe(422)
      const res = await otorgar("x".repeat(41))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual(NO_ENCONTRADO)
      expect((await quitar("a b")).status).toBe(404)
    })

    it("falla de base ⇒ 500 en usted", async () => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
      const { otorgarAcceso: mockeada } = await import("@/lib/clientes-tienda-acciones")
      vi.mocked(mockeada).mockRejectedValueOnce(new Error("boom"))
      const res = await otorgar("101")
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: "No se pudo dar acceso a Facturación. Inténtelo nuevamente.", code: "internal" })
      errorLog.mockRestore()
    })
  })

  describe("buscador de contactos", () => {
    it("devuelve {items} no cacheable", async () => {
      const res = await buscar("lumin")
      expect(res.status).toBe(200)
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      const body = await res.json()
      expect(body.items.map((c: { alegraId: string }) => c.alegraId)).toEqual(["101"])
    })

    it("menos de 2 caracteres ⇒ 400; demasiado larga ⇒ 400", async () => {
      const corta = await buscar(" a ")
      expect(corta.status).toBe(400)
      expect(await corta.json()).toEqual({ error: "Ingrese al menos 2 caracteres para buscar.", code: "q_corta" })
      const larga = await buscar("x".repeat(101))
      expect(larga.status).toBe(400)
      expect(await larga.json()).toEqual({ error: "La búsqueda es demasiado larga.", code: "invalid" })
    })
  })
})
