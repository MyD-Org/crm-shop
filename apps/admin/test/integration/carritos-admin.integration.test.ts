import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { campanias, catalogProducts } from "@/db/schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { listarCarritosAbandonados } from "@/lib/carritos-repo"
import {
  seedOperator,
  seedShopCart,
  seedShopCliente,
  seedShopOrder,
  seedTenant,
  truncateAll,
} from "./helpers"

// "Carritos abandonados" del admin (R2 de admin-carritos-intentos-pago): repo + API.
// Base real (crm_test) con el esquema `shop` de las migraciones REALES del Shop (0041 incluida:
// carts.con_items_desde). Sesión mockeada igual que clientes-tienda-admin.
// Datos inventados: tenant-a / tenant-b, mails @cliente.example.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const { GET: listRoute } = await import("@/app/api/admin/carritos/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"

const hace = (min: number) => new Date(Date.now() - min * 60_000)
const HORA = 60
const DIA = 24 * HORA

async function seedProducto(
  tenantId: string,
  alegraId: string,
  precio: number | null,
  extra: Partial<typeof catalogProducts.$inferInsert> = {},
) {
  await getDb()
    .insert(catalogProducts)
    .values({
      tenantId,
      alegraId,
      name: `Producto ${alegraId}`,
      brand: "Marca Test",
      // Los de Alegra no cuentan para el monto: se ponen distintos para que el test lo note.
      prices: precio === null ? [] : [{ idPriceList: "1", name: "General", price: precio * 3, main: true }],
      preciosOnline:
        precio === null
          ? []
          : [
              { idPriceList: "2", name: "Mayorista", price: 1, main: false },
              { idPriceList: "1", name: "General", price: precio, main: true },
            ],
      status: "active",
      ...extra,
    })
}

/** Cliente con sesión + su carrito. */
async function carrito(
  tenantId: string,
  clerkUserId: string,
  items: { id: string; qty: number }[],
  inactivoMin: number,
  extra: { conItemsDesde?: Date | null; cliente?: Parameters<typeof seedShopCliente>[1] } = {},
) {
  await seedShopCliente(tenantId, { clerkUserId, nombre: `Nombre ${clerkUserId}`, email: `${clerkUserId}@cliente.example`, ...extra.cliente })
  return seedShopCart(tenantId, clerkUserId, items, {
    updatedAt: hace(inactivoMin),
    conItemsDesde: extra.conItemsDesde === undefined ? hace(inactivoMin + 5) : extra.conItemsDesde,
  })
}

const listar = (f: Parameters<typeof listarCarritosAbandonados>[1] = {}) => listarCarritosAbandonados(TENANT_A, f)
const ids = (items: { clerkUserId: string }[]) => items.map((i) => i.clerkUserId).sort()

describe("carritos abandonados: repo", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("umbral por defecto de 1 h: 59 min no aparece, 61 min sí", async () => {
    await carrito(TENANT_A, "user_59", [{ id: "1", qty: 1 }], 59)
    await carrito(TENANT_A, "user_61", [{ id: "1", qty: 1 }], 61)
    const { items, total } = await listar()
    expect(ids(items)).toEqual(["user_61"])
    expect(total).toBe(1)
  })

  it("filtro de inactividad: con 24 h solo los inactivos desde hace 24 h o más", async () => {
    await carrito(TENANT_A, "user_2h", [{ id: "1", qty: 1 }], 2 * HORA)
    await carrito(TENANT_A, "user_25h", [{ id: "1", qty: 1 }], 25 * HORA)
    expect(ids((await listar({ horas: 24 })).items)).toEqual(["user_25h"])
    expect(ids((await listar({ horas: 1 })).items)).toEqual(["user_25h", "user_2h"])
  })

  it("un carrito vacío nunca aparece", async () => {
    await carrito(TENANT_A, "user_vacio", [], 5 * HORA, { conItemsDesde: null })
    expect((await listar()).total).toBe(0)
  })

  it("un cliente dado de baja (eliminado_en) no aparece", async () => {
    await carrito(TENANT_A, "user_baja", [{ id: "1", qty: 1 }], 5 * HORA, {
      cliente: { eliminadoEn: new Date(), email: null, emailNorm: null, nombre: null },
    })
    await carrito(TENANT_A, "user_vivo", [{ id: "1", qty: 1 }], 5 * HORA)
    expect(ids((await listar()).items)).toEqual(["user_vivo"])
  })

  it("sin con_items_desde la antigüedad sale de updated_at; con él, de con_items_desde", async () => {
    await carrito(TENANT_A, "user_sin", [{ id: "1", qty: 1 }], 3 * HORA, { conItemsDesde: null })
    const desde = hace(2 * DIA)
    await carrito(TENANT_A, "user_con", [{ id: "1", qty: 1 }], 3 * HORA, { conItemsDesde: desde })
    const { items } = await listar()
    const sin = items.find((i) => i.clerkUserId === "user_sin")!
    const con = items.find((i) => i.clerkUserId === "user_con")!
    expect(sin.conItemsDesde).toBeNull()
    expect(new Date(sin.ultimaActividad).getTime()).toBeLessThan(Date.now() - 2.9 * HORA * 60_000)
    expect(new Date(con.conItemsDesde!).getTime()).toBe(desde.getTime())
    expect(sin.horasInactivo).toBeGreaterThanOrEqual(3)
  })

  it("ventana de antigüedad: un carrito inactivo hace más de 30 días no aparece (90 sí)", async () => {
    await carrito(TENANT_A, "user_viejo", [{ id: "1", qty: 1 }], 45 * DIA)
    expect((await listar()).total).toBe(0)
    expect(ids((await listar({ dias: 90 })).items)).toEqual(["user_viejo"])
  })

  it("monto referencial: 2 ítems (100 x 2 + 50 x 1) = 250 con el precio de la lista principal", async () => {
    await seedProducto(TENANT_A, "10", 100)
    await seedProducto(TENANT_A, "11", 50)
    await carrito(TENANT_A, "user_m", [{ id: "10", qty: 2 }, { id: "11", qty: 1 }], 2 * HORA)
    const { items, montoTotalReferencial } = await listar()
    expect(items[0]).toMatchObject({ lineas: 2, unidades: 3, montoReferencial: 250, faltantes: 0 })
    expect(montoTotalReferencial).toBe(250)
    expect(items[0].productos.map((p) => p.nombre).sort()).toEqual(["Producto 10", "Producto 11"])
    expect(items[0].productos.find((p) => p.nombre === "Producto 10")).toMatchObject({ brand: "Marca Test", qty: 2 })
  })

  it("monto con IVA: el precio general de la web (neto + IVA al centavo), como la ficha", async () => {
    await seedProducto(TENANT_A, "20", 160133.6, { ivaPorcentaje: "21", code: "NK-ELEC-00008-BL-NOAK" })
    await carrito(TENANT_A, "user_iva", [{ id: "20", qty: 2 }], 2 * HORA)
    const [c] = (await listar()).items
    expect(c.montoReferencial).toBeCloseTo(193761.66 * 2, 2)
    expect(c.productos[0]).toMatchObject({ codigo: "NK-ELEC-00008-BL-NOAK", qty: 2 })
  })

  it("con una campaña activa usa su precio de la lista general; vencida o futura, el normal", async () => {
    const [activa] = await getDb()
      .insert(campanias)
      .values({ tenantId: TENANT_A, nombre: "Activa", etiqueta: "Oferta", inicio: hace(HORA), fin: new Date(Date.now() + DIA * 60_000) })
      .returning()
    const [futura] = await getDb()
      .insert(campanias)
      .values({ tenantId: TENANT_A, nombre: "Futura", etiqueta: "Pronto", inicio: new Date(Date.now() + DIA * 60_000), fin: new Date(Date.now() + 2 * DIA * 60_000) })
      .returning()
    const entrada = (id: string, precio: number) => ({
      id,
      reglaId: null,
      unidades: null,
      precios: [
        { idPriceList: "2", price: 1 },
        { idPriceList: "1", price: precio },
      ],
    })
    await seedProducto(TENANT_A, "30", 100, { ivaPorcentaje: "21", campaniasOnline: [entrada(futura.id, 50), entrada(activa.id, 80)] })
    await seedProducto(TENANT_A, "31", 100, { ivaPorcentaje: "21", campaniasOnline: [entrada(futura.id, 50)] })
    await carrito(TENANT_A, "user_camp", [{ id: "30", qty: 1 }, { id: "31", qty: 1 }], 2 * HORA)
    // 80 + 16,80 de IVA (campaña) + 100 + 21 (normal)
    expect((await listar()).items[0].montoReferencial).toBeCloseTo(96.8 + 121, 2)
  })

  it("producto sin espejo o sin precio: cuenta como faltante y el monto es parcial", async () => {
    await seedProducto(TENANT_A, "10", 100)
    await seedProducto(TENANT_A, "12", null) // existe pero sin precios
    await carrito(TENANT_A, "user_f", [{ id: "10", qty: 1 }, { id: "99", qty: 4 }, { id: "12", qty: 1 }], 2 * HORA)
    const [c] = (await listar()).items
    expect(c).toMatchObject({ lineas: 3, unidades: 6, montoReferencial: 100, faltantes: 2 })
  })

  it("un producto de otro tenant con el mismo id no aporta precio", async () => {
    await seedProducto(TENANT_B, "10", 999)
    await carrito(TENANT_A, "user_x", [{ id: "10", qty: 1 }], 2 * HORA)
    expect((await listar()).items[0]).toMatchObject({ montoReferencial: 0, faltantes: 1 })
  })

  it("muestra a lo sumo 3 productos por carrito", async () => {
    for (const id of ["1", "2", "3", "4", "5"]) await seedProducto(TENANT_A, id, 10)
    await carrito(TENANT_A, "user_p", ["1", "2", "3", "4", "5"].map((id) => ({ id, qty: 1 })), 2 * HORA)
    const [c] = (await listar()).items
    expect(c.lineas).toBe(5)
    expect(c.productos).toHaveLength(3)
  })

  describe("marca de pedido pendiente de pago en línea", () => {
    beforeEach(async () => {
      await carrito(TENANT_A, "user_pp", [{ id: "1", qty: 1 }], 2 * HORA)
      await carrito(TENANT_A, "user_libre", [{ id: "1", qty: 1 }], 2 * HORA)
    })

    it("con pedido pendiente en línea => marcado; el pedido con su número", async () => {
      const o = await seedShopOrder(TENANT_A, { clerkUserId: "user_pp", pagoMetodo: "mercadopago", pagoEstado: "pendiente" })
      const { items } = await listar()
      const marcado = items.find((i) => i.clerkUserId === "user_pp")!
      expect(marcado.pedidoPendiente).toMatchObject({ id: o.id, numero: o.numero })
      expect(marcado.pedidoPendiente?.numeroTexto).toMatch(/^PED-\d{8}$/)
      expect(items.find((i) => i.clerkUserId === "user_libre")!.pedidoPendiente).toBeNull()
    })

    it("no marcan: pagado, cancelado, transferencia, efectivo, cuenta corriente, a coordinar, más de 24 h, ajeno", async () => {
      const base = { clerkUserId: "user_pp", pagoMetodo: "mercadopago", pagoEstado: "pendiente" }
      await seedShopOrder(TENANT_A, { ...base, pagoEstado: "pagado" })
      await seedShopOrder(TENANT_A, { ...base, estado: "cancelado", cancelacionMotivo: "prueba" })
      for (const pagoMetodo of ["transferencia", "efectivo", "cuenta_corriente", "a_coordinar"]) {
        await seedShopOrder(TENANT_A, { ...base, pagoMetodo })
      }
      await seedShopOrder(TENANT_A, { ...base, createdAt: hace(25 * HORA) })
      await seedShopOrder(TENANT_B, { ...base })
      const { items } = await listar()
      expect(items.find((i) => i.clerkUserId === "user_pp")!.pedidoPendiente).toBeNull()
    })

    it("Payway también cuenta como pago en línea", async () => {
      await seedShopOrder(TENANT_A, { clerkUserId: "user_pp", pagoMetodo: "payway", pagoEstado: "pendiente" })
      expect((await listar()).items.find((i) => i.clerkUserId === "user_pp")!.pedidoPendiente).not.toBeNull()
    })

    it("filtro de pedido: sin_pedido excluye a los marcados; con_pedido_pendiente deja solo esos", async () => {
      await seedShopOrder(TENANT_A, { clerkUserId: "user_pp", pagoMetodo: "mercadopago", pagoEstado: "pendiente" })
      expect(ids((await listar({ pedido: "todos" })).items)).toEqual(["user_libre", "user_pp"])
      expect(ids((await listar({ pedido: "sin_pedido" })).items)).toEqual(["user_libre"])
      const con = await listar({ pedido: "con_pedido_pendiente" })
      expect(ids(con.items)).toEqual(["user_pp"])
      expect(con.total).toBe(1)
    })
  })

  it("búsqueda por email o nombre del cliente", async () => {
    await carrito(TENANT_A, "user_ana", [{ id: "1", qty: 1 }], 2 * HORA, { cliente: { nombre: "Ana Pérez", email: "ana@cliente.example", emailNorm: "ana@cliente.example" } })
    await carrito(TENANT_A, "user_beto", [{ id: "1", qty: 1 }], 2 * HORA, { cliente: { nombre: "Beto Gómez", email: "beto@cliente.example", emailNorm: "beto@cliente.example" } })
    expect(ids((await listar({ q: "ANA@" })).items)).toEqual(["user_ana"])
    expect(ids((await listar({ q: "gómez" })).items)).toEqual(["user_beto"])
    expect((await listar({ q: "%" })).total).toBe(0)
  })

  it("orden por última actividad descendente, paginación sin repetir y límite acotado a 50", async () => {
    for (let n = 0; n < 12; n++) await carrito(TENANT_A, `user_${String(n).padStart(2, "0")}`, [{ id: "1", qty: 1 }], 61 + n)
    const p1 = await listar({ start: 0, limit: 5 })
    const p2 = await listar({ start: 5, limit: 5 })
    expect(p1.total).toBe(12)
    expect(p1.items[0].clerkUserId).toBe("user_00")
    expect(new Set([...p1.items, ...p2.items].map((x) => x.clerkUserId)).size).toBe(10)
    expect((await listar({ limit: 1000 })).items).toHaveLength(12)
  })

  it("aislamiento por tenant: carritos, clientes y pedidos de B no aparecen ni cuentan", async () => {
    await carrito(TENANT_A, "user_a", [{ id: "1", qty: 1 }], 2 * HORA)
    await carrito(TENANT_B, "user_b", [{ id: "1", qty: 1 }], 2 * HORA)
    // Mismo usuario de Clerk con carrito en las dos tiendas, y un pedido pendiente solo en B.
    await carrito(TENANT_B, "user_a", [{ id: "1", qty: 1 }], 2 * HORA)
    await seedShopOrder(TENANT_B, { clerkUserId: "user_a", pagoMetodo: "mercadopago", pagoEstado: "pendiente" })
    const { items, total, montoTotalReferencial } = await listar()
    expect(total).toBe(1)
    expect(ids(items)).toEqual(["user_a"])
    expect(items[0].pedidoPendiente).toBeNull()
    expect(montoTotalReferencial).toBe(0)
  })

  it("el monto total referencial suma todos los carritos del filtro, no solo la página", async () => {
    await seedProducto(TENANT_A, "10", 100)
    for (let n = 0; n < 4; n++) await carrito(TENANT_A, `user_t${n}`, [{ id: "10", qty: 1 }], 2 * HORA + n)
    const { items, montoTotalReferencial } = await listar({ limit: 2 })
    expect(items).toHaveLength(2)
    expect(montoTotalReferencial).toBe(400)
  })
})

// ───────────────────────────── API ─────────────────────────────

function login(userId: string) {
  session = {
    mfa: "ok", userId,
    role: "admin",
    tenantId: TENANT_A,
    name: "Nombre De Cookie",
    email: "cookie@example.com",
    save: async () => {},
  }
}

const get = (query = "", host = TENANT_A) =>
  listRoute(new NextRequest(`http://${host}.localhost/api/admin/carritos${query}`, { headers: { host: `${host}.localhost` } }))

describe("carritos abandonados: GET /api/admin/carritos", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    invalidateTenantRegistry()
    login(await seedOperator(TENANT_A, { role: "admin" }))
    await carrito(TENANT_A, "user_a", [{ id: "1", qty: 1 }], 2 * HORA)
    await carrito(TENANT_B, "user_b", [{ id: "1", qty: 1 }], 2 * HORA)
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("sin sesión => 401 sin datos", async () => {
    session = {}
    const res = await get()
    expect(res.status).toBe(401)
    expect((await res.json()).items).toBeUndefined()
  })

  it("operador => 404 sin datos", async () => {
    login(await seedOperator(TENANT_A, { role: "operator" }))
    const res = await get()
    expect(res.status).toBe(404)
    expect((await res.json()).items).toBeUndefined()
  })

  it("un admin de otro tenant (host de A) no pasa el guard", async () => {
    login(await seedOperator(TENANT_B, { role: "admin" }))
    expect((await get()).status).toBe(401)
  })

  it("admin => 200 con los carritos de SU tenant, no cacheable", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({ clerkUserId: "user_a", email: "user_a@cliente.example" })
    expect(body).toHaveProperty("montoTotalReferencial")
  })

  it("superadmin también", async () => {
    login(await seedOperator(TENANT_A, { role: "superadmin" }))
    expect((await get()).status).toBe(200)
  })

  it("el tenant sale del guard: un tenantId en la query se ignora", async () => {
    expect((await (await get("?tenantId=tenant-b")).json()).items[0].clerkUserId).toBe("user_a")
  })

  it("filtros llegan al repo", async () => {
    expect((await (await get("?horas=24&dias=90&pedido=sin_pedido&q=user_a&start=0&limit=10")).json()).total).toBe(0)
    expect((await (await get("?horas=1&dias=30&pedido=sin_pedido&q=user_a")).json()).total).toBe(1)
  })

  it("parámetros inválidos => 400 en usted", async () => {
    for (const q of ["?horas=2", "?dias=5", "?pedido=otro", `?q=${"x".repeat(101)}`, "?start=-1", "?limit=0", "?limit=101"]) {
      const res = await get(q)
      expect(res.status, q).toBe(400)
      const body = await res.json()
      expect(body.code).toBe("invalid")
      expect(body.error).not.toMatch(/\b(tu|tus|vos|podés|probá)\b/i)
    }
  })
})
