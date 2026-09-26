import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { alegraContacts } from "@/db/schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import {
  CLIENTES_TIENDA_DEFAULT_LIMIT,
  CLIENTES_TIENDA_MAX_LIMIT,
  listarClientesTienda,
  type ClienteTiendaDto,
} from "@/lib/clientes-tienda-repo"
import {
  seedClientLink,
  seedOperator,
  seedShopCliente,
  seedShopOrder,
  seedTenant,
  truncateAll,
} from "./helpers"

// Listado "Clientes de la tienda" del admin (R3 de clientes-tienda-admin): repo + API.
// Base real (crm_test aislada) con el esquema `shop` de las migraciones REALES del Shop (0018
// incluida: shop.clientes). Sesión mockeada igual que pedidos-admin.
// Datos inventados: tenant-a / tenant-b, mails @cliente.example.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
// La función real, envuelta en un vi.fn para poder simular una falla de base en la API.
vi.mock("@/lib/clientes-tienda-repo", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/clientes-tienda-repo")>()
  return { ...real, listarClientesTienda: vi.fn(real.listarClientesTienda) }
})

const { GET: listRoute } = await import("@/app/api/admin/clientes-tienda/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"

type FilaContacto = typeof alegraContacts.$inferInsert

/** Contacto del espejo de Alegra. `corriente: true` ⇒ plazo > 0 (tipo_cuenta generada). */
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

const listar = (filtros: Parameters<typeof listarClientesTienda>[1] = {}) => listarClientesTienda(TENANT_A, filtros)
const porId = (items: ClienteTiendaDto[], clerkUserId: string) => {
  const fila = items.find((i) => i.clerkUserId === clerkUserId)
  if (!fila) throw new Error(`no está ${clerkUserId}`)
  return fila
}
const ids = (items: ClienteTiendaDto[]) => items.map((i) => i.clerkUserId)

/** Alta en Clerk escalonada por minutos: el orden del listado es por alta descendente. */
const alta = (min: number) => new Date(Date.UTC(2026, 8, 1, 12, min))

describe("clientes de la tienda: repo", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("aislamiento por tenant: usuarios, pedidos y contactos de otro tenant no aparecen ni cuentan", async () => {
    await seedShopCliente(TENANT_A, { clerkUserId: "user_a1", nombre: "Ana A" })
    await seedShopCliente(TENANT_B, { clerkUserId: "user_b1", nombre: "Beto B" })
    // Mismo usuario de Clerk registrado en las dos tiendas.
    await seedShopCliente(TENANT_B, { clerkUserId: "user_a1", nombre: "Ana en B" })
    await seedShopOrder(TENANT_A, { clerkUserId: "user_a1" })
    await seedShopOrder(TENANT_B, { clerkUserId: "user_a1" })
    await seedShopOrder(TENANT_B, { clerkUserId: "user_a1" })
    // Vínculo activo a un id que sólo existe como contacto en tenant-b.
    await seedClientLink("user_a1", { alegraContactId: "900", razonSocial: "Snapshot SA", tipoCuenta: "corriente" })
    await seedContacto(TENANT_B, "900", { name: "Empresa de B", corriente: true })

    const { items, total } = await listar()
    expect(total).toBe(1)
    expect(ids(items)).toEqual(["user_a1"])
    const a1 = items[0]
    expect(a1.nombre).toBe("Ana A")
    expect(a1.pedidos).toBe(1)
    // El contacto de B no se une: se ve el snapshot y el acceso es "no" (fail-closed, como el Shop).
    expect(a1.vinculo.razonSocial).toBe("Snapshot SA")
    expect(a1.tipoCuenta).toBeNull()
    expect(a1.acceso).toBe("no")
  })

  it("los usuarios eliminados en Clerk no aparecen", async () => {
    await seedShopCliente(TENANT_A, { clerkUserId: "user_vivo" })
    await seedShopCliente(TENANT_A, {
      clerkUserId: "user_baja",
      email: null,
      emailNorm: null,
      nombre: null,
      eliminadoEn: new Date(),
    })
    const { items, total } = await listar()
    expect(ids(items)).toEqual(["user_vivo"])
    expect(total).toBe(1)
  })

  it("estados del vínculo: sin_vincular, sin_coincidencia, ambiguo, vinculado, revocado", async () => {
    await seedShopCliente(TENANT_A, { clerkUserId: "user_nada" })
    await seedShopCliente(TENANT_A, { clerkUserId: "user_sc" })
    await seedShopCliente(TENANT_A, { clerkUserId: "user_amb" })
    await seedShopCliente(TENANT_A, { clerkUserId: "user_vinc" })
    await seedShopCliente(TENANT_A, { clerkUserId: "user_rev" })
    await seedClientLink("user_sc", { estado: "sin_coincidencia", alegraContactId: "", razonSocial: null })
    await seedClientLink("user_amb", { estado: "sin_coincidencia", alegraContactId: "ambiguo", razonSocial: null })
    await seedClientLink("user_vinc", { alegraContactId: "1001", metodo: "otp_email" })
    await seedClientLink("user_rev", {
      alegraContactId: "1001",
      estado: "revocada",
      revokedAt: new Date(),
    })
    await seedContacto(TENANT_A, "1001", { name: "Cliente Ejemplo SA", corriente: true })

    const { items } = await listar()
    expect(porId(items, "user_nada").vinculo).toEqual({
      estado: "sin_vincular",
      metodo: null,
      alegraContactId: null,
      razonSocial: null,
      desde: null,
    })
    expect(porId(items, "user_sc").vinculo.estado).toBe("sin_coincidencia")
    expect(porId(items, "user_amb").vinculo.estado).toBe("ambiguo")
    const vinc = porId(items, "user_vinc")
    expect(vinc.vinculo.estado).toBe("vinculado")
    expect(vinc.vinculo.metodo).toBe("otp_email")
    expect(vinc.vinculo.alegraContactId).toBe("1001")
    expect(vinc.vinculo.desde).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const rev = porId(items, "user_rev")
    expect(rev.vinculo.estado).toBe("revocado")
    expect(rev.acceso).toBe("no")
    expect(rev.tipoCuenta).toBeNull()
    for (const u of ["user_nada", "user_sc", "user_amb"]) expect(porId(items, u).acceso).toBe("no")
    // En R3 la excepción no existe todavía.
    expect(items.every((i) => i.excepcionVigente === false)).toBe(true)
  })

  it("un vínculo activo gana sobre un revocado más nuevo; si no hay activo, manda el más reciente", async () => {
    await seedShopCliente(TENANT_A, { clerkUserId: "user_x" })
    await seedClientLink("user_x", { alegraContactId: "1001", createdAt: new Date("2026-09-01T00:00:00Z") })
    await seedClientLink("user_x", {
      alegraContactId: "2002",
      estado: "revocada",
      createdAt: new Date("2026-09-10T00:00:00Z"),
      revokedAt: new Date("2026-09-11T00:00:00Z"),
    })
    await seedShopCliente(TENANT_A, { clerkUserId: "user_y" })
    await seedClientLink("user_y", { estado: "sin_coincidencia", alegraContactId: "", createdAt: new Date("2026-09-01T00:00:00Z") })
    await seedClientLink("user_y", {
      alegraContactId: "1001",
      estado: "revocada",
      createdAt: new Date("2026-09-05T00:00:00Z"),
      revokedAt: new Date("2026-09-06T00:00:00Z"),
    })
    const { items } = await listar()
    expect(porId(items, "user_x").vinculo).toMatchObject({ estado: "vinculado", alegraContactId: "1001" })
    expect(porId(items, "user_y").vinculo.estado).toBe("revocado")
  })

  it("vinculado a cuenta corriente activa ⇒ tipo corriente, acceso por cuenta corriente, razón social del espejo", async () => {
    await seedShopCliente(TENANT_A, { clerkUserId: "user_cc" })
    await seedClientLink("user_cc", { alegraContactId: "1001", razonSocial: "Nombre Viejo SA", tipoCuenta: "contado" })
    await seedContacto(TENANT_A, "1001", { name: "Cliente Ejemplo SA", corriente: true })
    await seedShopOrder(TENANT_A, { clerkUserId: "user_cc", createdAt: new Date("2026-09-02T10:00:00Z") })
    await seedShopOrder(TENANT_A, { clerkUserId: "user_cc", createdAt: new Date("2026-09-20T10:00:00Z") })
    await seedShopOrder(TENANT_A, { clerkUserId: "user_cc", createdAt: new Date("2026-09-10T10:00:00Z") })

    const { items } = await listar()
    const cc = porId(items, "user_cc")
    expect(cc.vinculo.razonSocial).toBe("Cliente Ejemplo SA")
    expect(cc.tipoCuenta).toBe("corriente")
    expect(cc.acceso).toBe("corriente")
    expect(cc.pedidos).toBe(3)
    expect(cc.ultimoPedidoEn).toBe("2026-09-20T10:00:00.000Z")
  })

  it("vinculado a contado ⇒ tipo contado y sin acceso", async () => {
    await seedShopCliente(TENANT_A, { clerkUserId: "user_co" })
    await seedClientLink("user_co", { alegraContactId: "1002" })
    await seedContacto(TENANT_A, "1002", { corriente: false })
    const { items } = await listar()
    expect(porId(items, "user_co")).toMatchObject({ tipoCuenta: "contado", acceso: "no", pedidos: 0, ultimoPedidoEn: null })
  })

  it("contacto vinculado inactivo o ausente en el espejo ⇒ snapshot, tipo vacío y acceso no", async () => {
    await seedShopCliente(TENANT_A, { clerkUserId: "user_inact" })
    await seedClientLink("user_inact", { alegraContactId: "1003", razonSocial: "Snapshot Inactivo SA", tipoCuenta: "corriente" })
    await seedContacto(TENANT_A, "1003", { name: "Espejo Inactivo SA", corriente: true, status: "inactive" })
    await seedShopCliente(TENANT_A, { clerkUserId: "user_aus" })
    await seedClientLink("user_aus", { alegraContactId: "1004", razonSocial: "Snapshot Ausente SA" })

    const { items } = await listar()
    expect(porId(items, "user_inact")).toMatchObject({
      tipoCuenta: null,
      acceso: "no",
      vinculo: { estado: "vinculado", razonSocial: "Snapshot Inactivo SA" },
    })
    expect(porId(items, "user_aus")).toMatchObject({
      tipoCuenta: null,
      acceso: "no",
      vinculo: { estado: "vinculado", razonSocial: "Snapshot Ausente SA" },
    })
  })

  it("contacto de otra cuenta de Alegra del mismo tenant no se une", async () => {
    await seedShopCliente(TENANT_A, { clerkUserId: "user_sec" })
    await seedClientLink("user_sec", { alegraContactId: "1005", razonSocial: "Snapshot SA" })
    await seedContacto(TENANT_A, "1005", { corriente: true, extra: { alegraAccount: "secundaria" } })
    const { items } = await listar()
    expect(porId(items, "user_sec")).toMatchObject({ acceso: "no", tipoCuenta: null })
  })

  describe("filtros", () => {
    beforeEach(async () => {
      // cc: vinculado corriente con pedido · co: vinculado contado sin pedidos
      // nada: sin vínculo con pedido · rev: revocado
      await seedShopCliente(TENANT_A, { clerkUserId: "user_cc", creadoEnClerk: alta(4) })
      await seedShopCliente(TENANT_A, { clerkUserId: "user_co", creadoEnClerk: alta(3) })
      await seedShopCliente(TENANT_A, { clerkUserId: "user_nada", creadoEnClerk: alta(2) })
      await seedShopCliente(TENANT_A, { clerkUserId: "user_rev", creadoEnClerk: alta(1) })
      await seedContacto(TENANT_A, "1001", { corriente: true })
      await seedContacto(TENANT_A, "1002", { corriente: false })
      await seedClientLink("user_cc", { alegraContactId: "1001" })
      await seedClientLink("user_co", { alegraContactId: "1002" })
      await seedClientLink("user_rev", { alegraContactId: "1001", estado: "revocada", revokedAt: new Date() })
      await seedShopOrder(TENANT_A, { clerkUserId: "user_cc" })
      await seedShopOrder(TENANT_A, { clerkUserId: "user_nada" })
    })

    it("vínculo: vinculados / sin vincular (incluye revocados y sin coincidencia)", async () => {
      expect(ids((await listar({ vinculo: "vinculados" })).items)).toEqual(["user_cc", "user_co"])
      const sin = await listar({ vinculo: "sin_vincular" })
      expect(ids(sin.items)).toEqual(["user_nada", "user_rev"])
      expect(sin.total).toBe(2)
    })

    it("acceso: con / sin", async () => {
      expect(ids((await listar({ acceso: "con" })).items)).toEqual(["user_cc"])
      expect(ids((await listar({ acceso: "sin" })).items)).toEqual(["user_co", "user_nada", "user_rev"])
    })

    it("con pedidos", async () => {
      const r = await listar({ pedidos: "con" })
      expect(ids(r.items)).toEqual(["user_cc", "user_nada"])
      expect(r.total).toBe(2)
    })

    it("se combinan", async () => {
      expect(ids((await listar({ vinculo: "sin_vincular", pedidos: "con" })).items)).toEqual(["user_nada"])
      expect((await listar({ vinculo: "vinculados", acceso: "sin", pedidos: "con" })).total).toBe(0)
    })

    it("'todos' es sin filtro", async () => {
      expect((await listar({ vinculo: "todos", acceso: "todos", pedidos: "todos" })).total).toBe(4)
    })
  })

  describe("búsqueda", () => {
    // Emails explícitos sin `_`: el de por defecto lleva el clerk_user_id (user_…).
    beforeEach(async () => {
      await seedShopCliente(TENANT_A, { clerkUserId: "user_ana", nombre: "Ana Pérez", email: "Ana.Perez@Cliente.example", emailNorm: "ana.perez@cliente.example", creadoEnClerk: alta(5) })
      await seedShopCliente(TENANT_A, { clerkUserId: "user_pct", email: "pct@cliente.example", nombre: "Descuento 100% Real", creadoEnClerk: alta(4) })
      await seedShopCliente(TENANT_A, { clerkUserId: "user_und", email: "und@cliente.example", nombre: "guion_bajo", creadoEnClerk: alta(3) })
      await seedShopCliente(TENANT_A, { clerkUserId: "user_bar", email: "bar@cliente.example", nombre: "barra\\invertida", creadoEnClerk: alta(2) })
      await seedShopCliente(TENANT_A, { clerkUserId: "user_otro", email: "otro@cliente.example", nombre: "Otro Nombre", creadoEnClerk: alta(1) })
    })

    it("por nombre sin distinguir mayúsculas", async () => {
      expect(ids((await listar({ q: "aNA pé" })).items)).toEqual(["user_ana"])
    })

    it("por email sin distinguir mayúsculas", async () => {
      expect(ids((await listar({ q: "PEREZ@CLIENTE" })).items)).toEqual(["user_ana"])
    })

    it("recorta espacios y una búsqueda vacía no filtra", async () => {
      expect(ids((await listar({ q: "  otro  " })).items)).toEqual(["user_otro"])
      expect((await listar({ q: "   " })).total).toBe(5)
    })

    it("% _ y \\ se buscan literales, no como comodines", async () => {
      expect(ids((await listar({ q: "%" })).items)).toEqual(["user_pct"])
      expect(ids((await listar({ q: "_" })).items)).toEqual(["user_und"])
      expect(ids((await listar({ q: "\\" })).items)).toEqual(["user_bar"])
    })

    it("también por la razón social del contacto vinculado", async () => {
      await seedContacto(TENANT_A, "1001", { name: "Luminarias del Sur SA" })
      await seedClientLink("user_otro", { alegraContactId: "1001", razonSocial: "Otra cosa" })
      expect(ids((await listar({ q: "luminarias" })).items)).toEqual(["user_otro"])
    })

    it("sin coincidencias ⇒ lista vacía y total 0", async () => {
      expect(await listar({ q: "zzz" })).toEqual({ items: [], total: 0 })
    })
  })

  describe("orden y paginación", () => {
    beforeEach(async () => {
      for (let i = 0; i < 60; i++) {
        await seedShopCliente(TENANT_A, { clerkUserId: `user_${String(i).padStart(2, "0")}`, creadoEnClerk: alta(i) })
      }
      // Sin fecha de alta (p. ej. un tombstone revivido no aplica; un alta vieja sin dato): al final.
      await seedShopCliente(TENANT_A, { clerkUserId: "user_sin_alta", creadoEnClerk: null })
    })

    it("orden por alta descendente, sin alta al final, página por defecto de 25", async () => {
      const r = await listar()
      expect(r.total).toBe(61)
      expect(r.items).toHaveLength(CLIENTES_TIENDA_DEFAULT_LIMIT)
      expect(r.items[0].clerkUserId).toBe("user_59")
      expect(r.items[0].altaEn).toBe(alta(59).toISOString())
      const ultima = await listar({ start: 50, limit: 50 })
      expect(ultima.items.at(-1)?.clerkUserId).toBe("user_sin_alta")
      expect(ultima.items.at(-1)?.altaEn).toBeNull()
    })

    it("start y limit paginan sin repetir", async () => {
      const p1 = await listar({ start: 0, limit: 10 })
      const p2 = await listar({ start: 10, limit: 10 })
      expect(ids(p1.items)).toHaveLength(10)
      expect(ids(p2.items)[0]).toBe("user_49")
      expect(new Set([...ids(p1.items), ...ids(p2.items)]).size).toBe(20)
    })

    it("limit mayor a 50 se acota; start negativo se toma como 0", async () => {
      expect((await listar({ limit: 1000 })).items).toHaveLength(CLIENTES_TIENDA_MAX_LIMIT)
      expect((await listar({ start: -5, limit: 1 })).items[0].clerkUserId).toBe("user_59")
    })
  })
})

// ───────────────────────────── API ─────────────────────────────

function login(userId: string) {
  session = {
    userId,
    role: "operator",
    tenantId: TENANT_A,
    name: "Nombre De Cookie",
    email: "cookie@example.com",
    save: async () => {},
  }
}

const adminReq = (path: string, host = TENANT_A) =>
  new NextRequest(`http://${host}.localhost${path}`, { headers: { host: `${host}.localhost` } })
const get = (query = "", host?: string) => listRoute(adminReq(`/api/admin/clientes-tienda${query}`, host))

describe("clientes de la tienda: GET /api/admin/clientes-tienda", () => {
  let operatorA: string

  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    operatorA = await seedOperator(TENANT_A, { role: "operator" })
    invalidateTenantRegistry()
    login(operatorA)
    await seedShopCliente(TENANT_A, { clerkUserId: "user_a1", email: "a1@cliente.example", creadoEnClerk: alta(2) })
    await seedShopCliente(TENANT_A, { clerkUserId: "user_a2", email: "a2@cliente.example", creadoEnClerk: alta(1) })
    await seedShopCliente(TENANT_B, { clerkUserId: "user_b1", email: "b1@cliente.example" })
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("sin sesión ⇒ 401 sin datos", async () => {
    session = {}
    const res = await get()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.items).toBeUndefined()
  })

  it("operador ⇒ 200 con los clientes de SU tenant y no cacheable", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    const body = (await res.json()) as { items: ClienteTiendaDto[]; total: number }
    expect(body.total).toBe(2)
    expect(ids(body.items)).toEqual(["user_a1", "user_a2"])
    expect(body.items[0]).toMatchObject({ email: "a1@cliente.example", acceso: "no", pedidos: 0 })
  })

  it("admin y superadmin también ven el listado", async () => {
    for (const role of ["admin", "superadmin"] as const) {
      login(await seedOperator(TENANT_A, { role }))
      expect((await get()).status).toBe(200)
    }
  })

  it("un operador de otro tenant (host de A) no pasa el guard", async () => {
    const operatorB = await seedOperator(TENANT_B, { role: "operator" })
    login(operatorB)
    const res = await get()
    expect(res.status).toBe(401)
  })

  it("el tenant sale del guard: un tenantId en la query se ignora", async () => {
    const body = await (await get("?tenantId=tenant-b")).json()
    expect(ids(body.items)).toEqual(["user_a1", "user_a2"])
  })

  it("pasa filtros, búsqueda y paginación al repo", async () => {
    const body = await (await get("?q=A2%40CLIENTE&vinculo=sin_vincular&acceso=sin&pedidos=todos&start=0&limit=10")).json()
    expect(ids(body.items)).toEqual(["user_a2"])
    expect(body.total).toBe(1)
    const pag = await (await get("?start=1&limit=1")).json()
    expect(ids(pag.items)).toEqual(["user_a2"])
    expect(pag.total).toBe(2)
  })

  it.each([
    ["?vinculo=otro", "El filtro de vínculo es inválido"],
    ["?vinculo=", "El filtro de vínculo es inválido"],
    ["?acceso=quizas", "El filtro de acceso es inválido"],
    ["?pedidos=sin", "El filtro de pedidos es inválido"],
    [`?q=${"x".repeat(101)}`, "La búsqueda es demasiado larga"],
    ["?start=-1", "La paginación es inválida"],
    ["?start=abc", "La paginación es inválida"],
    ["?start=", "La paginación es inválida"],
    ["?limit=0", "El límite es inválido"],
    ["?limit=1000", "El límite es inválido"],
    ["?limit=2.5", "El límite es inválido"],
  ])("parámetro inválido %s ⇒ 400 %s", async (query, error) => {
    const res = await get(query)
    expect(res.status).toBe(400)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await res.json()).toEqual({ error, code: "invalid" })
  })

  it("limit entre 51 y 100 se acepta y el repo lo acota a 50", async () => {
    const res = await get("?limit=100")
    expect(res.status).toBe(200)
  })

  it("falla de base ⇒ 500 con el texto en usted, sin detalle ni emails en el log", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(listarClientesTienda).mockRejectedValueOnce(
      Object.assign(new Error('relation "shop.clientes" does not exist — a1@cliente.example'), { code: "42P01" }),
    )
    const res = await get()
    expect(res.status).toBe(500)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await res.json()).toEqual({
      error: "No se pudieron cargar los clientes de la tienda. Inténtelo nuevamente.",
      code: "internal",
    })
    const logs = errorLog.mock.calls.map((c) => c.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "))
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.join("\n")).not.toContain("@")
    errorLog.mockRestore()
  })
})
