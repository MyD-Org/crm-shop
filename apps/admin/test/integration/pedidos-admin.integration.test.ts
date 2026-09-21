import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { adminUsers } from "@/db/schema"
import { shopOrders, shopOrderItems, type ShopOrderRow } from "@/db/shop-schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import {
  ESTADOS_PEDIDO,
  mensajeTransicionInvalida,
  puedeTransicionar,
  type EstadoPedido,
} from "@/lib/pedidos-transiciones"
import { seedOperator, seedShopOrder, seedShopOrderItem, seedTenant, truncateAll } from "./helpers"

// Tests de integración de la sección "Pedidos" del CRM (ADM-1..ADM-8).
// La base es real (crm_test) y el esquema `shop` sale de las migraciones REALES del Shop
// (ver global-setup). Se mockean iron-session y next/headers, igual que el test de comprobantes.
//
// Nada de datos reales: tenants tenant-a/tenant-b, mails @example.com / .example.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const { GET: listRoute } = await import("@/app/api/admin/pedidos/route")
const { GET: detailRoute, PATCH: patchRoute } = await import("@/app/api/admin/pedidos/[id]/route")
const { GET: comprobantesRoute } = await import("@/app/api/admin/comprobantes/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"

const NOT_FOUND_BODY = { error: "No encontrado", code: "not_found" }
const UNAUTHORIZED_BODY = { error: "No autorizado", code: "unauthorized" }
const CONFLICT_MSG = "El pedido fue modificado por otra persona. Actualice la página e inténtelo nuevamente."

function login(userId: string, opts: { cookieRole?: string; tenantId?: string } = {}) {
  // La cookie DICE un rol y un tenant; el guard manda lo de la fila fresca y el host.
  session = {
    userId,
    role: opts.cookieRole ?? "operator",
    tenantId: opts.tenantId ?? TENANT_A,
    name: "Nombre De Cookie",
    email: "cookie@example.com",
    save: async () => {},
  }
}
function logout() {
  session = {}
}

// NextRequest no materializa el Host desde la URL: se pasa explícito (el guard resuelve el
// tenant del host).
const adminReq = (path: string, init: { method?: string; body?: unknown; rawBody?: string; host?: string } = {}) => {
  const host = init.host ?? TENANT_A
  const body = init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined)
  return new NextRequest(`http://${host}.localhost${path}`, {
    method: init.method ?? "GET",
    ...(body !== undefined ? { body } : {}),
    headers: { host: `${host}.localhost` },
  })
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

const list = (query = "", host?: string) => listRoute(adminReq(`/api/admin/pedidos${query}`, { host }))
const detail = (id: string, host?: string) => detailRoute(adminReq(`/api/admin/pedidos/${id}`, { host }), idParams(id))
const patch = (id: string, body: unknown, host?: string, query = "") =>
  patchRoute(adminReq(`/api/admin/pedidos/${id}${query}`, { method: "PATCH", body, host }), idParams(id))

async function rowById(id: string): Promise<ShopOrderRow> {
  const [row] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, id))
  if (!row) throw new Error(`el pedido ${id} no existe`)
  return row
}

/** Pedido sembrado directamente en un estado (cancelado exige motivo por el CHECK de la base). */
function seedEn(estado: EstadoPedido, tenantId = TENANT_A, overrides: Parameters<typeof seedShopOrder>[1] = {}) {
  return seedShopOrder(tenantId, {
    estado,
    ...(estado === "cancelado" ? { cancelacionMotivo: "Motivo original" } : {}),
    ...overrides,
  })
}

let operatorA: string
let adminA: string
let superA: string
let operatorB: string
let superB: string

describe("admin: pedidos del Shop", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    operatorA = await seedOperator(TENANT_A, { role: "operator", name: "Ope Rador", email: "ope@example.com" })
    adminA = await seedOperator(TENANT_A, { role: "admin", name: "Ana Admin", email: "ana@example.com" })
    superA = await seedOperator(TENANT_A, { role: "superadmin", name: "Beto Super", email: "beto@example.com" })
    operatorB = await seedOperator(TENANT_B, { role: "operator", name: "Ope Bee", email: "ope.b@example.com" })
    superB = await seedOperator(TENANT_B, { role: "superadmin", name: "Super Bee", email: "super.b@example.com" })
    invalidateTenantRegistry()
    login(operatorA)
  })

  afterAll(async () => {
    await truncateAll()
  })

  // ───────────────────────────── ADM-1: autorización ─────────────────────────────
  describe("ADM-1: requireOperatorPlus", () => {
    let pedido: ShopOrderRow

    beforeEach(async () => {
      pedido = await seedEn("pendiente")
    })

    const RUTAS: [string, () => Promise<Response>][] = [
      ["GET lista", () => list()],
      ["GET detalle", () => detail(pedido.id)],
      ["PATCH", () => patch(pedido.id, { estado: "confirmado", estadoEsperado: "pendiente" })],
    ]

    it("operator, admin y superadmin → 200", async () => {
      for (const [userId, cookieRole] of [
        [operatorA, "operator"],
        [adminA, "admin"],
        [superA, "superadmin"],
      ]) {
        login(userId, { cookieRole })
        expect((await list()).status).toBe(200)
        expect((await detail(pedido.id)).status).toBe(200)
      }
    })

    it.each(RUTAS)("%s → 401 sin sesión, con el cuerpo estándar y sin filtrar el motivo", async (_n, call) => {
      logout()
      const res = await call()
      expect(res.status).toBe(401)
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      const body = await res.json()
      expect(body).toEqual(UNAUTHORIZED_BODY)
      expect(JSON.stringify(body)).not.toMatch(/no-session|tenant-mismatch|user-gone|inactive/)
    })

    it.each(RUTAS)("%s → 401 si la cookie es de otro tenant que el host", async (_n, call) => {
      login(operatorA, { tenantId: TENANT_B })
      const res = await call()
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual(UNAUTHORIZED_BODY)
    })

    it.each(RUTAS)("%s → 401 si la fila de admin_users ya no existe", async (_n, call) => {
      await getDb().delete(adminUsers).where(eq(adminUsers.id, operatorA))
      const res = await call()
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual(UNAUTHORIZED_BODY)
    })

    it.each(RUTAS)("%s → 401 si la cuenta está desactivada (sin passwordHash)", async (_n, call) => {
      await getDb().update(adminUsers).set({ passwordHash: null }).where(eq(adminUsers.id, operatorA))
      expect((await call()).status).toBe(401)
    })

    it.each(RUTAS)("%s → 404 para un rol desconocido (allow-list, no rank)", async (_n, call) => {
      // `roleRank("viewer")` da 0 = operator: por eso el guard NO puede ser "rank >= 0".
      await getDb().update(adminUsers).set({ role: "viewer" }).where(eq(adminUsers.id, operatorA))
      login(operatorA, { cookieRole: "operator" }) // la cookie miente; manda la fila
      const res = await call()
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual(NOT_FOUND_BODY)
    })

    it("un rol desconocido no modifica nada", async () => {
      await getDb().update(adminUsers).set({ role: "viewer" }).where(eq(adminUsers.id, operatorA))
      const antes = await rowById(pedido.id)
      await patch(pedido.id, { estado: "confirmado", estadoEsperado: "pendiente" })
      expect(await rowById(pedido.id)).toEqual(antes)
    })

    it("sin sesión tampoco modifica nada", async () => {
      logout()
      const antes = await rowById(pedido.id)
      await patch(pedido.id, { estado: "confirmado", estadoEsperado: "pendiente" })
      expect(await rowById(pedido.id)).toEqual(antes)
    })

    it("requireAdminPlus no cambió: operator sigue viendo 404 en /api/admin/comprobantes", async () => {
      login(operatorA)
      const res = await comprobantesRoute(adminReq("/api/admin/comprobantes"))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual(NOT_FOUND_BODY)
    })
  })

  // ───────────────────────────── ADM-2: listado ─────────────────────────────
  describe("ADM-2: listado", () => {
    it("más nuevos primero, con total y la forma del ítem", async () => {
      const viejo = await seedEn("pendiente", TENANT_A, { createdAt: new Date("2026-01-01T10:00:00Z") })
      const medio = await seedEn("confirmado", TENANT_A, { createdAt: new Date("2026-01-02T10:00:00Z") })
      const nuevo = await seedEn("pendiente", TENANT_A, {
        createdAt: new Date("2026-01-03T10:00:00Z"),
        entregaTipo: "envio",
        requiereRevision: true,
        clienteRazonSocial: "Cliente Ejemplo SA",
        total: "2500.50",
      })

      const res = await list()
      expect(res.status).toBe(200)
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      const body = await res.json()
      expect(body.total).toBe(3)
      expect(body.items.map((i: { id: string }) => i.id)).toEqual([nuevo.id, medio.id, viejo.id])
      expect(body.items[0]).toEqual({
        id: nuevo.id,
        numero: `PED-${String(nuevo.numero).padStart(8, "0")}`,
        creadoEn: "2026-01-03T10:00:00.000Z",
        estado: "pendiente",
        contactoNombre: "Carla Compradora",
        clienteRazonSocial: "Cliente Ejemplo SA",
        entregaTipo: "envio",
        pagoMetodo: "a_coordinar",
        pagoEstado: "pendiente",
        total: 2500.5,
        requiereRevision: true,
      })
      // El motivo interno y los datos de contacto finos no viajan en el listado.
      expect(body.items[0]).not.toHaveProperty("cancelacionMotivo")
    })

    it("desempate estable con la misma fecha (created_at desc, id desc)", async () => {
      const mismaFecha = new Date("2026-02-01T00:00:00Z")
      const a = await seedEn("pendiente", TENANT_A, { createdAt: mismaFecha })
      const b = await seedEn("pendiente", TENANT_A, { createdAt: mismaFecha })
      const esperado = [a.id, b.id].sort().reverse()
      const body = await (await list()).json()
      expect(body.items.map((i: { id: string }) => i.id)).toEqual(esperado)
    })

    it("filtro por estado", async () => {
      await seedEn("pendiente")
      await seedEn("pendiente")
      await seedEn("confirmado")
      const body = await (await list("?estado=pendiente")).json()
      expect(body.total).toBe(2)
      expect(body.items).toHaveLength(2)
      expect(body.items.every((i: { estado: string }) => i.estado === "pendiente")).toBe(true)

      const todos = await (await list("?estado=todos")).json()
      expect(todos.total).toBe(3)
    })

    it("paginación: start/limit y total independiente de la página", async () => {
      for (let i = 0; i < 25; i++) {
        await seedEn("pendiente", TENANT_A, { createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) })
      }
      const pagina = await (await list("?start=20&limit=10")).json()
      expect(pagina.items).toHaveLength(5)
      expect(pagina.total).toBe(25)

      const fuera = await (await list("?start=100")).json()
      expect(fuera.items).toHaveLength(0)
      expect(fuera.total).toBe(25)

      const primera = await (await list("?limit=10")).json()
      const segunda = await (await list("?start=10&limit=10")).json()
      const ids = new Set([...primera.items, ...segunda.items].map((i: { id: string }) => i.id))
      expect(ids.size).toBe(20) // sin repetidos ni saltos entre páginas
    })

    it.each([
      ["?estado=despachado", "El filtro de estado es inválido"],
      ["?estado=", "El filtro de estado es inválido"],
      ["?start=-1", "La paginación es inválida"],
      ["?start=abc", "La paginación es inválida"],
      ["?start=1.5", "La paginación es inválida"],
      ["?limit=0", "El límite es inválido"],
      ["?limit=101", "El límite es inválido"],
      ["?limit=abc", "El límite es inválido"],
    ])("parámetro inválido %s → 400 «%s»", async (query, error) => {
      const res = await list(query)
      expect(res.status).toBe(400)
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      expect(await res.json()).toEqual({ error, code: "invalid" })
    })

    it("limit=100 se acepta (el repo lo acota)", async () => {
      await seedEn("pendiente")
      expect((await list("?limit=100")).status).toBe(200)
    })

    it("sin pedidos: lista vacía, total 0", async () => {
      expect(await (await list()).json()).toEqual({ items: [], total: 0 })
    })
  })

  // ───────────────────────────── ADM-3: detalle ─────────────────────────────
  describe("ADM-3: detalle", () => {
    it("pedido propio con sus ítems y totales congelados", async () => {
      const pedido = await seedEn("pendiente", TENANT_A, {
        clienteCodigo: "CLI-1",
        clienteRazonSocial: "Cliente Ejemplo SA",
        clienteCuit: "30-00000000-0",
        entregaTipo: "envio",
        entregaCiudad: "Ciudad Ejemplo",
        entregaDireccion: "Calle Falsa 123",
        facturacionTipoDoc: "CUIT",
        facturacionNroDoc: "30000000000",
        facturacionRazonSocial: "Cliente Ejemplo SA",
        facturacionCondicionIva: "Responsable Inscripto",
        facturacionDomicilio: "Calle Falsa 123",
        costoEnvio: "150.00",
        total: "1360.00",
        notas: "Entregar por la tarde",
      })
      await seedShopOrderItem(pedido.id, { name: "Lámpara A" })
      await seedShopOrderItem(pedido.id, { name: "Lámpara B", alegraItemId: "item-2", qty: "1.500" })

      const res = await detail(pedido.id)
      expect(res.status).toBe(200)
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      const body = await res.json()
      expect(body).toMatchObject({
        id: pedido.id,
        numero: `PED-${String(pedido.numero).padStart(8, "0")}`,
        estado: "pendiente",
        cliente: {
          codigo: "CLI-1",
          razonSocial: "Cliente Ejemplo SA",
          cuit: "30-00000000-0",
          email: "comprador@cliente.example",
        },
        contacto: { nombre: "Carla Compradora", telefono: "+54 11 5555-0100" },
        entrega: { tipo: "envio", ciudad: "Ciudad Ejemplo", direccion: "Calle Falsa 123" },
        facturacion: {
          tipoDoc: "CUIT",
          nroDoc: "30000000000",
          razonSocial: "Cliente Ejemplo SA",
          condicionIva: "Responsable Inscripto",
          domicilio: "Calle Falsa 123",
        },
        requiereRevision: false,
        pagoMetodo: "a_coordinar",
        pagoEstado: "pendiente",
        subtotal: 1000,
        iva: 210,
        costoEnvio: 150,
        total: 1360,
        notas: "Entregar por la tarde",
        cancelacionMotivo: null,
        estadoActualizadoEn: null,
        estadoActualizadoPor: null,
        estadoActualizadoPorNombre: null,
      })
      expect(body.items).toHaveLength(2)
      expect(body.items.map((i: { name: string }) => i.name).sort()).toEqual(["Lámpara A", "Lámpara B"])
      const itemB = body.items.find((i: { name: string }) => i.name === "Lámpara B")
      expect(itemB).toMatchObject({ qty: 1.5, precioUnitario: 500, ivaPorcentaje: 21, subtotal: 1000, iva: 210, total: 1210 })
      // El tenant es interno: no se serializa.
      expect(body).not.toHaveProperty("tenantId")
    })

    it("id malformado o inexistente → el mismo 404 (nunca 500)", async () => {
      for (const id of ["not-a-uuid", randomUUID(), "", "'; drop table shop.orders; --"]) {
        const res = await detail(id)
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual(NOT_FOUND_BODY)
      }
    })

    it("un pedido cancelado muestra el motivo interno en el detalle del CRM", async () => {
      const pedido = await seedEn("cancelado")
      const body = await (await detail(pedido.id)).json()
      expect(body.cancelacionMotivo).toBe("Motivo original")
    })
  })

  // ───────────────────────────── ADM-4: máquina de estados ─────────────────────────────
  describe("ADM-4: los 36 pares ordenados, por HTTP", () => {
    const PARES = ESTADOS_PEDIDO.flatMap((desde) => ESTADOS_PEDIDO.map((hacia) => [desde, hacia] as const))

    it.each(PARES)("%s → %s", async (desde, hacia) => {
      const pedido = await seedEn(desde)
      const antes = await rowById(pedido.id)
      const t0 = Date.now()
      const res = await patch(pedido.id, {
        estado: hacia,
        estadoEsperado: desde,
        ...(hacia === "cancelado" ? { motivo: "Sin stock" } : {}),
      })
      const t1 = Date.now()

      if (puedeTransicionar(desde, hacia)) {
        expect(res.status).toBe(200)
        expect(res.headers.get("Cache-Control")).toBe("private, no-store")
        const body = await res.json()
        expect(body.estado).toBe(hacia)
        const despues = await rowById(pedido.id)
        expect(despues.estado).toBe(hacia)
        // ADM-7: auditoría.
        expect(despues.estadoActualizadoPor).toBe(operatorA)
        expect(despues.estadoActualizadoPorNombre).toBe("Ope Rador")
        expect(despues.estadoActualizadoEn).not.toBeNull()
        expect(despues.estadoActualizadoEn!.getTime()).toBeGreaterThanOrEqual(t0 - 1000)
        expect(despues.estadoActualizadoEn!.getTime()).toBeLessThanOrEqual(t1 + 1000)
        expect(despues.updatedAt.getTime()).toBe(despues.estadoActualizadoEn!.getTime())
        expect(despues.cancelacionMotivo).toBe(hacia === "cancelado" ? "Sin stock" : antes.cancelacionMotivo)
      } else {
        expect(res.status).toBe(422)
        expect(res.headers.get("Cache-Control")).toBe("private, no-store")
        expect(await res.json()).toEqual({ error: mensajeTransicionInvalida(desde, hacia), code: "invalid_transition" })
        // Fila idéntica: estado, auditoría, motivo y updated_at.
        expect(await rowById(pedido.id)).toEqual(antes)
      }
    })

    it("mensajes canónicos de los casos con regla propia", async () => {
      const entregado = await seedEn("entregado")
      const r1 = await patch(entregado.id, { estado: "cancelado", estadoEsperado: "entregado", motivo: "x" })
      expect(await r1.json()).toEqual({ error: "Un pedido entregado no se puede cancelar.", code: "invalid_transition" })
      expect((await rowById(entregado.id)).cancelacionMotivo).toBeNull() // el motivo NO se guardó

      const cancelado = await seedEn("cancelado")
      const r2 = await patch(cancelado.id, { estado: "pendiente", estadoEsperado: "cancelado" })
      expect(await r2.json()).toEqual({
        error: "El pedido está cancelado y no admite más cambios de estado.",
        code: "invalid_transition",
      })

      const pendiente = await seedEn("pendiente")
      const r3 = await patch(pendiente.id, { estado: "entregado", estadoEsperado: "pendiente" })
      expect(await r3.json()).toEqual({
        error: "No es posible cambiar el pedido de «Pendiente» a «Entregado».",
        code: "invalid_transition",
      })
    })

    it("confirmado → entregado no depende del tipo de entrega (envío también)", async () => {
      const pedido = await seedEn("confirmado", TENANT_A, { entregaTipo: "envio" })
      const res = await patch(pedido.id, { estado: "entregado", estadoEsperado: "confirmado" })
      expect(res.status).toBe(200)
      expect((await rowById(pedido.id)).estado).toBe("entregado")
    })

    it("el 200 devuelve el detalle completo, con ítems", async () => {
      const pedido = await seedEn("pendiente")
      await seedShopOrderItem(pedido.id)
      const body = await (await patch(pedido.id, { estado: "confirmado", estadoEsperado: "pendiente" })).json()
      expect(body).toMatchObject({
        id: pedido.id,
        estado: "confirmado",
        estadoActualizadoPor: operatorA,
        estadoActualizadoPorNombre: "Ope Rador",
      })
      expect(body.items).toHaveLength(1)
    })
  })

  describe("ADM-4: payload inválido → 400", () => {
    const INVALID = { error: "El estado indicado no es válido.", code: "invalid" }

    it.each([
      ["sin estado", { estadoEsperado: "pendiente" }],
      ["sin estadoEsperado", { estado: "confirmado" }],
      ["estado desconocido", { estado: "despachado", estadoEsperado: "pendiente" }],
      ["estadoEsperado desconocido", { estado: "confirmado", estadoEsperado: "despachado" }],
      ["estado no string", { estado: 1, estadoEsperado: "pendiente" }],
      ["body null", null],
      ["body array", []],
      ["body string", "confirmado"],
    ])("%s", async (_n, body) => {
      const pedido = await seedEn("pendiente")
      const antes = await rowById(pedido.id)
      const res = await patch(pedido.id, body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual(INVALID)
      expect(await rowById(pedido.id)).toEqual(antes)
    })

    it("body que no es JSON", async () => {
      const pedido = await seedEn("pendiente")
      const res = await patchRoute(
        adminReq(`/api/admin/pedidos/${pedido.id}`, { method: "PATCH", rawBody: "{no es json" }),
        idParams(pedido.id),
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual(INVALID)
    })
  })

  // ───────────────────────────── ADM-6: motivo ─────────────────────────────
  describe("ADM-6: cancelar exige motivo", () => {
    it.each([
      ["ausente", undefined],
      ["vacío", ""],
      ["sólo espacios", "   "],
      ["número", 7],
      ["null", null],
      ["objeto", { texto: "x" }],
    ])("motivo %s → 422 reason_required, fila intacta", async (_n, motivo) => {
      const pedido = await seedEn("pendiente")
      const antes = await rowById(pedido.id)
      const res = await patch(pedido.id, { estado: "cancelado", estadoEsperado: "pendiente", motivo })
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ error: "Indique el motivo de la cancelación.", code: "reason_required" })
      expect(await rowById(pedido.id)).toEqual(antes)
    })

    it("501 caracteres → 422 reason_too_long; 500 exactos → 200", async () => {
      const pedido = await seedEn("pendiente")
      const antes = await rowById(pedido.id)
      const largo = await patch(pedido.id, { estado: "cancelado", estadoEsperado: "pendiente", motivo: "x".repeat(501) })
      expect(largo.status).toBe(422)
      expect(await largo.json()).toEqual({
        error: "El motivo no puede superar los 500 caracteres.",
        code: "reason_too_long",
      })
      expect(await rowById(pedido.id)).toEqual(antes)

      // El largo se mide después del trim: 500 + espacios alrededor entra.
      const justo = await patch(pedido.id, {
        estado: "cancelado",
        estadoEsperado: "pendiente",
        motivo: `  ${"x".repeat(500)}  `,
      })
      expect(justo.status).toBe(200)
      expect((await rowById(pedido.id)).cancelacionMotivo).toBe("x".repeat(500))
    })

    it("camino feliz: se guarda recortado, junto con el cambio de estado, y el detalle lo muestra", async () => {
      const pedido = await seedEn("en_camino")
      const res = await patch(pedido.id, {
        estado: "cancelado",
        estadoEsperado: "en_camino",
        motivo: "  Cliente desistió  ",
      })
      expect(res.status).toBe(200)
      const fila = await rowById(pedido.id)
      expect(fila.estado).toBe("cancelado")
      expect(fila.cancelacionMotivo).toBe("Cliente desistió")
      expect(fila.estadoActualizadoPor).toBe(operatorA)
      expect((await (await detail(pedido.id)).json()).cancelacionMotivo).toBe("Cliente desistió")
    })

    it("en una transición que no cancela, el motivo se ignora (la columna queda NULL)", async () => {
      const pedido = await seedEn("pendiente")
      const res = await patch(pedido.id, { estado: "confirmado", estadoEsperado: "pendiente", motivo: "x" })
      expect(res.status).toBe(200)
      expect((await rowById(pedido.id)).cancelacionMotivo).toBeNull()
    })

    it("un motivo inválido en una transición que no cancela no molesta", async () => {
      const pedido = await seedEn("pendiente")
      const res = await patch(pedido.id, { estado: "confirmado", estadoEsperado: "pendiente", motivo: "x".repeat(900) })
      expect(res.status).toBe(200)
    })
  })

  // ───────────────────────────── ADM-5: concurrencia ─────────────────────────────
  describe("ADM-5: concurrencia optimista → 409", () => {
    it("estadoEsperado viejo: 409, nada guardado", async () => {
      const pedido = await seedEn("confirmado")
      const antes = await rowById(pedido.id)
      const res = await patch(pedido.id, { estado: "cancelado", estadoEsperado: "pendiente", motivo: "x" })
      expect(res.status).toBe(409)
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      expect(await res.json()).toEqual({ error: CONFLICT_MSG, code: "conflict", estadoActual: "confirmado" })
      expect(await rowById(pedido.id)).toEqual(antes) // ni estado, ni motivo, ni auditoría
    })

    it("dos operadores a la vez: exactamente un 200 y un 409; gana uno solo", async () => {
      const pedido = await seedEn("pendiente")
      const [a, b] = await Promise.all([
        patch(pedido.id, { estado: "confirmado", estadoEsperado: "pendiente" }),
        patch(pedido.id, { estado: "cancelado", estadoEsperado: "pendiente", motivo: "Carrera" }),
      ])
      expect([a.status, b.status].sort()).toEqual([200, 409])
      const fila = await rowById(pedido.id)
      if (a.status === 200) {
        expect(fila.estado).toBe("confirmado")
        expect(fila.cancelacionMotivo).toBeNull() // el perdedor no dejó su motivo
      } else {
        expect(fila.estado).toBe("cancelado")
        expect(fila.cancelacionMotivo).toBe("Carrera")
      }
    })

    it("precedencia: par prohibido + estadoEsperado viejo → 422 (la tabla va primero)", async () => {
      const pedido = await seedEn("confirmado")
      const antes = await rowById(pedido.id)
      const res = await patch(pedido.id, { estado: "entregado", estadoEsperado: "pendiente" })
      expect(res.status).toBe(422)
      expect((await res.json()).code).toBe("invalid_transition")
      expect(await rowById(pedido.id)).toEqual(antes)
    })

    it("precedencia: motivo faltante + estadoEsperado viejo → 422 reason_required (antes de tocar la base)", async () => {
      const pedido = await seedEn("confirmado")
      const res = await patch(pedido.id, { estado: "cancelado", estadoEsperado: "pendiente" })
      expect(res.status).toBe(422)
      expect((await res.json()).code).toBe("reason_required")
    })
  })

  // ───────────────────────────── ADM-7: auditoría ─────────────────────────────
  describe("ADM-7: auditoría", () => {
    it("el siguiente cambio, de otra persona, pisa al anterior", async () => {
      const pedido = await seedEn("pendiente")
      await patch(pedido.id, { estado: "confirmado", estadoEsperado: "pendiente" })
      const primero = await rowById(pedido.id)
      expect(primero.estadoActualizadoPor).toBe(operatorA)

      login(adminA, { cookieRole: "admin" })
      await patch(pedido.id, { estado: "pendiente", estadoEsperado: "confirmado" }) // corrección
      const segundo = await rowById(pedido.id)
      expect(segundo.estadoActualizadoPor).toBe(adminA)
      expect(segundo.estadoActualizadoPorNombre).toBe("Ana Admin")
      expect(segundo.estadoActualizadoEn!.getTime()).toBeGreaterThanOrEqual(primero.estadoActualizadoEn!.getTime())
    })

    it("el actor sale de la sesión: el body no puede suplantarlo", async () => {
      const pedido = await seedEn("pendiente")
      await patch(pedido.id, {
        estado: "confirmado",
        estadoEsperado: "pendiente",
        estadoActualizadoPor: adminA,
        estadoActualizadoPorNombre: "Otro",
        actor: { id: adminA, name: "Otro" },
      })
      const fila = await rowById(pedido.id)
      expect(fila.estadoActualizadoPor).toBe(operatorA)
      // El nombre es el de la FILA de admin_users, no el de la cookie.
      expect(fila.estadoActualizadoPorNombre).toBe("Ope Rador")
    })

    it("no se toca nada más: totales, pago, notas del cliente e ítems", async () => {
      const pedido = await seedEn("pendiente", TENANT_A, { notas: "Nota del cliente" })
      const item = await seedShopOrderItem(pedido.id)
      const antes = await rowById(pedido.id)
      await patch(pedido.id, {
        estado: "confirmado",
        estadoEsperado: "pendiente",
        total: 1,
        pagoEstado: "pagado",
        pagoMetodo: "efectivo",
        notas: "pisada",
      })
      const despues = await rowById(pedido.id)
      expect({
        ...despues,
        estado: antes.estado,
        estadoActualizadoEn: antes.estadoActualizadoEn,
        estadoActualizadoPor: antes.estadoActualizadoPor,
        estadoActualizadoPorNombre: antes.estadoActualizadoPorNombre,
        updatedAt: antes.updatedAt,
      }).toEqual(antes)
      const [itemDespues] = await getDb().select().from(shopOrderItems).where(eq(shopOrderItems.id, item.id))
      expect(itemDespues).toEqual(item)
    })
  })

  // ───────────────────────────── ADM-8: aislamiento entre tenants ─────────────────────────────
  describe("ADM-8: aislamiento entre tenants", () => {
    let deA: ShopOrderRow
    let deB: ShopOrderRow

    beforeEach(async () => {
      deA = await seedEn("pendiente", TENANT_A)
      deB = await seedEn("pendiente", TENANT_B)
    })

    it("listado: cada tenant ve sólo lo suyo, y el total no cuenta lo ajeno", async () => {
      login(operatorB, { tenantId: TENANT_B })
      const b = await (await list("", TENANT_B)).json()
      expect(b.total).toBe(1)
      expect(b.items.map((i: { id: string }) => i.id)).toEqual([deB.id])

      login(operatorA)
      const a = await (await list()).json()
      expect(a.total).toBe(1)
      expect(a.items.map((i: { id: string }) => i.id)).toEqual([deA.id])
    })

    it("detalle: el pedido de otro tenant es indistinguible de uno inexistente", async () => {
      login(operatorB, { tenantId: TENANT_B })
      const ajeno = await detail(deA.id, TENANT_B)
      const inexistente = await detail(randomUUID(), TENANT_B)
      expect(ajeno.status).toBe(404)
      expect(await ajeno.json()).toEqual(await inexistente.json())
    })

    it("PATCH válido sobre un pedido ajeno → 404 (no 409 ni 422) y la fila no cambia", async () => {
      login(operatorB, { tenantId: TENANT_B })
      const antes = await rowById(deA.id)
      const res = await patch(deA.id, { estado: "confirmado", estadoEsperado: "pendiente" }, TENANT_B)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual(NOT_FOUND_BODY)
      expect(await rowById(deA.id)).toEqual(antes)

      // También con estadoEsperado viejo: sigue siendo 404, no 409 (no hay oráculo de existencia).
      const stale = await patch(deA.id, { estado: "preparacion", estadoEsperado: "confirmado" }, TENANT_B)
      expect(stale.status).toBe(404)

      // Y cancelar con motivo tampoco lo alcanza.
      const cancel = await patch(deA.id, { estado: "cancelado", estadoEsperado: "pendiente", motivo: "x" }, TENANT_B)
      expect(cancel.status).toBe(404)
      expect(await rowById(deA.id)).toEqual(antes)
    })

    it("el tenant no se acepta por query ni por body", async () => {
      login(operatorB, { tenantId: TENANT_B })
      const lista = await (await list(`?tenantId=${TENANT_A}`, TENANT_B)).json()
      expect(lista.items.map((i: { id: string }) => i.id)).toEqual([deB.id])

      const antes = await rowById(deA.id)
      const res = await patch(
        deA.id,
        { estado: "confirmado", estadoEsperado: "pendiente", tenantId: TENANT_A },
        TENANT_B,
        `?tenantId=${TENANT_A}`,
      )
      expect(res.status).toBe(404)
      expect(await rowById(deA.id)).toEqual(antes)
    })

    it("el superadmin también queda acotado a su tenant", async () => {
      login(superB, { cookieRole: "superadmin", tenantId: TENANT_B })
      const lista = await (await list("", TENANT_B)).json()
      expect(lista.items.map((i: { id: string }) => i.id)).toEqual([deB.id])
      expect((await detail(deA.id, TENANT_B)).status).toBe(404)
      const res = await patch(deA.id, { estado: "confirmado", estadoEsperado: "pendiente" }, TENANT_B)
      expect(res.status).toBe(404)
      expect((await rowById(deA.id)).estado).toBe("pendiente")
    })

    it("una sesión de tenant-a contra el host de tenant-b → 401 (no cruza por el host)", async () => {
      login(operatorA) // cookie de tenant-a
      expect((await list("", TENANT_B)).status).toBe(401)
      expect((await detail(deB.id, TENANT_B)).status).toBe(401)
    })
  })

  // ───────────────────────────── ADM-11: falla ruidosa ─────────────────────────────
  describe("ADM-11: si la consulta al esquema shop falla, 500 y log (no un 200 vacío)", () => {
    it("listado", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      // No se puede tirar el esquema `shop` de la base compartida en medio de la suite, así que
      // se simula el error de Postgres ("relation does not exist") a la altura del repo.
      const repo = await import("@/lib/pedidos-repo")
      const spy = vi.spyOn(repo, "listarPedidos").mockRejectedValueOnce(new Error('relation "shop.orders" does not exist'))
      const res = await list()
      expect(res.status).toBe(500)
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      const body = await res.json()
      expect(body).toEqual({ error: "No se pudieron cargar los pedidos. Inténtelo nuevamente.", code: "internal" })
      expect(JSON.stringify(body)).not.toContain("shop.orders") // el detalle técnico va al log
      expect(errorSpy).toHaveBeenCalled()
      spy.mockRestore()
      errorSpy.mockRestore()
    })
  })

  it("la base sigue teniendo el CHECK como última red (SQL crudo con estado inválido)", async () => {
    const pedido = await seedEn("pendiente")
    await expect(
      getDb().execute(sql`update shop.orders set estado = 'x' where id = ${pedido.id}`),
    ).rejects.toThrow()
  })
})
