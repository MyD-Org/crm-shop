import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { shopOrderPayments } from "@/db/shop-schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { intentosDelPedido, listarIntentos, resumenIntentos } from "@/lib/pagos-intentos-repo"
import { seedOperator, seedShopOrder, seedShopPagoIntento, seedTenant, truncateAll } from "./helpers"

// "Intentos de pago" del admin (R3 de admin-carritos-intentos-pago): repo + APIs.
// Base real (crm_test) con el esquema `shop` de las migraciones REALES del Shop (0041 incluida:
// error_proveedor / error_status). Sesión mockeada igual que clientes-tienda-admin.
// Datos inventados: tenant-a / tenant-b, mails @cliente.example.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const { GET: listRoute } = await import("@/app/api/admin/pagos-intentos/route")
const { GET: resumenRoute } = await import("@/app/api/admin/pagos-intentos/resumen/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"

const hace = (min: number) => new Date(Date.now() - min * 60_000)
const diasAtras = (d: number) => hace(d * 24 * 60)

/** Pedido en línea + un intento. */
async function intento(
  tenantId: string,
  overrides: Parameters<typeof seedShopPagoIntento>[2] = {},
  pedido: Parameters<typeof seedShopOrder>[1] = {},
) {
  const o = await seedShopOrder(tenantId, { pagoMetodo: "mercadopago", ...pedido })
  const i = await seedShopPagoIntento(o.id, tenantId, overrides)
  return { o, i }
}

describe("intentos de pago: repo", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
  })

  afterAll(async () => {
    await truncateAll()
  })

  describe("clasificación de causas", () => {
    it("cada caso cae en UNA clase, con la precedencia del diseño", async () => {
      const casos: Record<string, Parameters<typeof seedShopPagoIntento>[2]> = {
        aprobado: { estado: "pagado", referencia: "pay-1" },
        rechazo_banco: { estado: "fallido", referencia: "pay-2", detalle: "cc_rejected_insufficient_amount" },
        // 5xx del proveedor y luego descartarReserva: el error sigue, la clase es error_proveedor.
        error_proveedor_abandonado: {
          estado: "fallido",
          detalle: "reserva_abandonada",
          errorProveedor: "internal_error",
          errorStatus: 500,
        },
        // 5xx todavía abierto (sin referencia).
        error_proveedor_abierto: { estado: "pendiente", errorProveedor: "internal_error", errorStatus: 500 },
        credenciales: { estado: "fallido", detalle: "credenciales_rechazadas: 401", errorStatus: 401 },
        reserva_abandonada: { estado: "fallido", detalle: "reserva_abandonada" },
        pendiente: { estado: "pendiente" },
      }
      const porClave = new Map<string, string>()
      for (const [clave, over] of Object.entries(casos)) {
        const { i } = await intento(TENANT_A, over)
        porClave.set(i.id, clave)
      }
      const { items } = await listarIntentos(TENANT_A, { dias: 7 })
      const clase = (clave: string) => items.find((x) => porClave.get(x.id) === clave)?.clase
      expect(clase("aprobado")).toBe("aprobado")
      expect(clase("rechazo_banco")).toBe("rechazo_banco")
      expect(clase("error_proveedor_abandonado")).toBe("error_proveedor")
      expect(clase("error_proveedor_abierto")).toBe("error_proveedor")
      expect(clase("credenciales")).toBe("credenciales")
      expect(clase("reserva_abandonada")).toBe("reserva_abandonada")
      expect(clase("pendiente")).toBe("pendiente")
    })

    it("un pagado nunca es falla aunque conserve un error previo", async () => {
      const { i } = await intento(TENANT_A, { estado: "pagado", referencia: "pay-9", errorProveedor: "x", errorStatus: 500 })
      const { items } = await listarIntentos(TENANT_A, {})
      expect(items.find((x) => x.id === i.id)?.clase).toBe("aprobado")
    })
  })

  describe("resumen", () => {
    it("proveedor × cuenta: 3 aprobados + 1 error del proveedor en MP/igz => tasa 25 %", async () => {
      for (let n = 0; n < 3; n++) await intento(TENANT_A, { estado: "pagado", referencia: `ok-${n}` })
      await intento(TENANT_A, { estado: "fallido", detalle: "reserva_abandonada", errorProveedor: "internal_error", errorStatus: 500 })
      await intento(TENANT_A, { estado: "pendiente" }) // en curso: fuera del denominador
      await intento(TENANT_A, { proveedor: "payway", cuenta: "mdp", cuentaPrevista: "mdp", estado: "fallido", referencia: "pw-1", detalle: "rechazada" })

      const r = await resumenIntentos(TENANT_A, { dias: 7 })
      const mp = r.cuentas.find((c) => c.proveedor === "mercadopago" && c.cuenta === "igz")
      expect(mp).toMatchObject({ total: 5, aprobados: 3, errorProveedor: 1, pendientes: 1, tasaFallo: 0.25 })
      const pw = r.cuentas.find((c) => c.proveedor === "payway")
      expect(pw).toMatchObject({ cuenta: "mdp", rechazoBanco: 1, tasaFallo: 1 })
    })

    it("la ventana corta: lo anterior a N días no cuenta", async () => {
      await intento(TENANT_A, { estado: "pagado", referencia: "r1", createdAt: diasAtras(2) })
      await intento(TENANT_A, { estado: "pagado", referencia: "r2", createdAt: diasAtras(8) })
      expect((await resumenIntentos(TENANT_A, { dias: 7 })).cuentas[0].total).toBe(1)
      expect((await resumenIntentos(TENANT_A, { dias: 30 })).cuentas[0].total).toBe(2)
      expect((await resumenIntentos(TENANT_A, { dias: 1 })).cuentas).toEqual([])
    })

    it("sin cuenta de cobro ni prevista => 'sin_cuenta'", async () => {
      await intento(TENANT_A, { cuenta: null, cuentaPrevista: null, estado: "pagado", referencia: "r" })
      expect((await resumenIntentos(TENANT_A, { dias: 7 })).cuentas[0].cuenta).toBe("sin_cuenta")
    })

    it("transferencia y efectivo se cuentan aparte y no tocan el resumen ni la tasa", async () => {
      await intento(TENANT_A, { estado: "pagado", referencia: "r" })
      const antes = await resumenIntentos(TENANT_A, { dias: 7 })
      await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
      await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
      await seedShopOrder(TENANT_A, { pagoMetodo: "efectivo" })
      const despues = await resumenIntentos(TENANT_A, { dias: 7 })
      expect(despues.cuentas).toEqual(antes.cuentas)
      expect(despues.offline).toEqual({ transferencia: 2, efectivo: 1 })
    })

    it("aislamiento por tenant", async () => {
      await intento(TENANT_A, { estado: "pagado", referencia: "a" })
      await intento(TENANT_B, { estado: "fallido", detalle: "x", referencia: "b" })
      const r = await resumenIntentos(TENANT_A, { dias: 7 })
      expect(r.cuentas).toHaveLength(1)
      expect(r.cuentas[0]).toMatchObject({ total: 1, aprobados: 1 })
    })
  })

  describe("lista", () => {
    it("trae el diagnóstico del intento y el pedido, más nuevo primero", async () => {
      const viejo = await intento(TENANT_A, { estado: "pagado", referencia: "v", createdAt: hace(60) })
      const nuevo = await intento(
        TENANT_A,
        { estado: "pendiente", errorProveedor: "internal_error | cause: 500 x", errorStatus: 500, createdAt: hace(5) },
        { contactoNombre: "Carla Compradora", clienteEmail: "carla@cliente.example" },
      )
      const { items, total } = await listarIntentos(TENANT_A, {})
      expect(total).toBe(2)
      expect(items.map((x) => x.id)).toEqual([nuevo.i.id, viejo.i.id])
      expect(items[0]).toMatchObject({
        fuente: "intento",
        pedidoId: nuevo.o.id,
        clase: "error_proveedor",
        errorProveedor: "internal_error | cause: 500 x",
        errorStatus: 500,
        clienteEmail: "carla@cliente.example",
        proveedor: "mercadopago",
        cuenta: "igz",
      })
      expect(items[0].pedidoNumeroTexto).toMatch(/^PED-\d{8}$/)
    })

    it("intento histórico sin error: errorProveedor y errorStatus null", async () => {
      await intento(TENANT_A, { estado: "fallido", referencia: "h", detalle: "cc_rejected" })
      const [fila] = (await listarIntentos(TENANT_A, {})).items
      expect(fila.errorProveedor).toBeNull()
      expect(fila.errorStatus).toBeNull()
    })

    it("filtros: proveedor, cuenta, clase y 'fallos'", async () => {
      await intento(TENANT_A, { estado: "pagado", referencia: "1" })
      await intento(TENANT_A, { estado: "fallido", detalle: "reserva_abandonada", errorProveedor: "e", errorStatus: 500 })
      await intento(TENANT_A, { proveedor: "payway", cuenta: "mdp", estado: "fallido", referencia: "p", detalle: "rechazada" })
      expect((await listarIntentos(TENANT_A, { proveedor: "payway" })).total).toBe(1)
      expect((await listarIntentos(TENANT_A, { cuenta: "mdp" })).total).toBe(1)
      expect((await listarIntentos(TENANT_A, { cuenta: "igz" })).total).toBe(2)
      expect((await listarIntentos(TENANT_A, { clase: "error_proveedor" })).total).toBe(1)
      expect((await listarIntentos(TENANT_A, { clase: "aprobado" })).total).toBe(1)
      expect((await listarIntentos(TENANT_A, { clase: "fallos" })).total).toBe(2)
    })

    it("búsqueda por número de pedido, por email y por nombre", async () => {
      const a = await intento(TENANT_A, { estado: "pagado", referencia: "1" }, { clienteEmail: "ana@cliente.example", contactoNombre: "Ana Pérez" })
      await intento(TENANT_A, { estado: "pagado", referencia: "2" }, { clienteEmail: "beto@cliente.example", contactoNombre: "Beto Gómez" })
      expect((await listarIntentos(TENANT_A, { q: String(a.o.numero) })).items.map((x) => x.pedidoId)).toEqual([a.o.id])
      expect((await listarIntentos(TENANT_A, { q: `PED-${String(a.o.numero).padStart(8, "0")}` })).total).toBe(1)
      expect((await listarIntentos(TENANT_A, { q: "BETO@" })).total).toBe(1)
      expect((await listarIntentos(TENANT_A, { q: "pérez" })).total).toBe(1)
      expect((await listarIntentos(TENANT_A, { q: "%" })).total).toBe(0)
    })

    it("paginación sin repetir y límite acotado a 50", async () => {
      for (let n = 0; n < 12; n++) await intento(TENANT_A, { estado: "pagado", referencia: `p${n}`, createdAt: hace(n + 1) })
      const p1 = await listarIntentos(TENANT_A, { start: 0, limit: 5 })
      const p2 = await listarIntentos(TENANT_A, { start: 5, limit: 5 })
      expect(p1.total).toBe(12)
      expect(new Set([...p1.items, ...p2.items].map((x) => x.id)).size).toBe(10)
      expect((await listarIntentos(TENANT_A, { limit: 1000 })).items).toHaveLength(12)
    })

    it("transferencia y efectivo sin intento aparecen como filas offline: pendiente o acreditada (anulado no cuenta)", async () => {
      const pend = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
      const acre = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
      const anul = await seedShopOrder(TENANT_A, { pagoMetodo: "efectivo" })
      const vigente = { tenantId: TENANT_A, amount: "100.00", paidOn: "2026-10-01" }
      await getDb().insert(shopOrderPayments).values({ ...vigente, orderId: acre.id })
      await getDb().insert(shopOrderPayments).values({ ...vigente, orderId: anul.id, anuladoEn: new Date() })

      const { items } = await listarIntentos(TENANT_A, {})
      const por = (id: string) => items.find((x) => x.pedidoId === id)
      expect(por(pend.id)).toMatchObject({ fuente: "offline", clase: "offline", estado: "pendiente", proveedor: "transferencia", cuenta: null })
      expect(por(acre.id)?.estado).toBe("pagado")
      expect(por(anul.id)).toMatchObject({ estado: "pendiente", proveedor: "efectivo" })
      // Filtrar por proveedor online o por falla las deja afuera.
      expect((await listarIntentos(TENANT_A, { proveedor: "mercadopago" })).total).toBe(0)
      expect((await listarIntentos(TENANT_A, { clase: "fallos" })).total).toBe(0)
      expect((await listarIntentos(TENANT_A, { proveedor: "transferencia" })).total).toBe(2)
    })

    it("un pedido por transferencia que SÍ tiene intento no se duplica como fila offline", async () => {
      const o = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
      await seedShopPagoIntento(o.id, TENANT_A, { estado: "pagado", referencia: "x" })
      const { items } = await listarIntentos(TENANT_A, {})
      expect(items.filter((x) => x.pedidoId === o.id)).toHaveLength(1)
    })

    it("aislamiento por tenant: intentos y pedidos de B no aparecen en A", async () => {
      await intento(TENANT_A, { estado: "pagado", referencia: "a" })
      await intento(TENANT_B, { estado: "pagado", referencia: "b" })
      await seedShopOrder(TENANT_B, { pagoMetodo: "transferencia" })
      const { items, total } = await listarIntentos(TENANT_A, {})
      expect(total).toBe(1)
      expect(items).toHaveLength(1)
    })
  })

  describe("intentosDelPedido", () => {
    it("lista los intentos del pedido, el más nuevo primero, con su motivo", async () => {
      const o = await seedShopOrder(TENANT_A, { pagoMetodo: "mercadopago" })
      await seedShopPagoIntento(o.id, TENANT_A, { estado: "pendiente", errorProveedor: "internal_error", errorStatus: 500, createdAt: hace(30) })
      const ok = await seedShopPagoIntento(o.id, TENANT_A, { estado: "pagado", referencia: "pay-1", createdAt: hace(10) })
      const r = await intentosDelPedido(TENANT_A, o.id)
      expect(r).toHaveLength(2)
      expect(r[0]).toMatchObject({ id: ok.id, clase: "aprobado" })
      expect(r[1]).toMatchObject({ clase: "error_proveedor", errorProveedor: "internal_error", errorStatus: 500 })
    })

    it("un pedido de otro tenant, uno inexistente o un id malformado devuelven vacío", async () => {
      const ajeno = await intento(TENANT_B, { estado: "pagado", referencia: "b" })
      expect(await intentosDelPedido(TENANT_A, ajeno.o.id)).toEqual([])
      expect(await intentosDelPedido(TENANT_A, "00000000-0000-4000-8000-000000000000")).toEqual([])
      expect(await intentosDelPedido(TENANT_A, "no-es-un-uuid")).toEqual([])
    })

    it("un pedido por transferencia no tiene intentos", async () => {
      const o = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
      expect(await intentosDelPedido(TENANT_A, o.id)).toEqual([])
    })
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

const req = (path: string, host = TENANT_A) =>
  new NextRequest(`http://${host}.localhost${path}`, { headers: { host: `${host}.localhost` } })
const getLista = (query = "", host?: string) => listRoute(req(`/api/admin/pagos-intentos${query}`, host))
const getResumen = (query = "", host?: string) => resumenRoute(req(`/api/admin/pagos-intentos/resumen${query}`, host))

describe("intentos de pago: GET /api/admin/pagos-intentos", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    invalidateTenantRegistry()
    login(await seedOperator(TENANT_A, { role: "admin" }))
    await intento(TENANT_A, { estado: "pagado", referencia: "a1" })
    await intento(TENANT_A, { estado: "pendiente", errorProveedor: "internal_error", errorStatus: 500 })
    await intento(TENANT_B, { estado: "pagado", referencia: "b1" })
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("sin sesión => 401 sin datos", async () => {
    session = {}
    for (const res of [await getLista(), await getResumen()]) {
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.items).toBeUndefined()
      expect(body.cuentas).toBeUndefined()
    }
  })

  it("operador => 404 sin datos", async () => {
    login(await seedOperator(TENANT_A, { role: "operator" }))
    for (const res of [await getLista(), await getResumen()]) {
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.items).toBeUndefined()
      expect(body.cuentas).toBeUndefined()
    }
  })

  it("un admin de otro tenant (host de A) no pasa el guard", async () => {
    login(await seedOperator(TENANT_B, { role: "admin" }))
    expect((await getLista()).status).toBe(401)
  })

  it("admin => 200 con los intentos de SU tenant, no cacheable, con el error del proveedor", async () => {
    const res = await getLista()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.items.some((x: { errorProveedor: string | null }) => x.errorProveedor === "internal_error")).toBe(true)
  })

  it("el tenant sale del guard: un tenantId en la query se ignora", async () => {
    expect((await (await getLista("?tenantId=tenant-b")).json()).total).toBe(2)
  })

  it("filtros y paginación llegan al repo", async () => {
    const body = await (await getLista("?clase=error_proveedor&proveedor=mercadopago&cuenta=igz&dias=30&start=0&limit=10")).json()
    expect(body.total).toBe(1)
  })

  it("parámetros inválidos => 400 en usted", async () => {
    for (const q of ["?dias=5", "?proveedor=otro", "?clase=zzz", "?cuenta=A%20B", `?q=${"x".repeat(101)}`, "?start=-1", "?limit=0", "?limit=101"]) {
      const res = await getLista(q)
      expect(res.status, q).toBe(400)
      const body = await res.json()
      expect(body.code).toBe("invalid")
      expect(body.error).not.toMatch(/\b(tu|tus|vos|podés|probá)\b/i)
    }
  })

  it("resumen: 200 con cuentas, offline y desde; ventana inválida => 400", async () => {
    const res = await getResumen("?dias=7")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cuentas[0]).toMatchObject({ proveedor: "mercadopago", cuenta: "igz", total: 2 })
    expect(body.offline).toEqual({ transferencia: 0, efectivo: 0 })
    expect(typeof body.desde).toBe("string")
    expect((await getResumen("?dias=3")).status).toBe(400)
  })
})
