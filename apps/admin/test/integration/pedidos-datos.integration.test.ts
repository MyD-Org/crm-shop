import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { eq, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { shopOrderEventos, type ShopOrderEventoRow } from "@/db/shop-schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedOperator, seedShopOrder, seedTenant, truncateAll } from "./helpers"

// Cambio `admin-pedidos-datos`: rediseño de Pedidos del admin — historial de eventos
// (`shop.order_eventos`, migración 0020 del Shop) + listado con búsqueda, filtros, colas y
// tablero. Datos inventados, dominio `.example`.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
const sendEmail = vi.fn(async (..._args: unknown[]) => true)
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

const { GET: listRoute } = await import("@/app/api/admin/pedidos/route")
const { GET: detailRoute, PATCH: patchRoute } = await import("@/app/api/admin/pedidos/[id]/route")
const { POST: pagoPOST, DELETE: pagoDELETE } = await import("@/app/api/admin/pedidos/[id]/pago/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"

function login(userId: string, tenantId = TENANT_A) {
  session = { userId, role: "operator", tenantId, name: "Ope Rador", email: "ope@example.com", save: async () => {} }
}

const adminReq = (path: string, init: { method?: string; body?: unknown; host?: string } = {}) => {
  const host = init.host ?? TENANT_A
  return new NextRequest(`http://${host}.localhost${path}`, {
    method: init.method ?? "GET",
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { host: `${host}.localhost` },
  })
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

const list = (query = "", host?: string) => listRoute(adminReq(`/api/admin/pedidos${query}`, { host }))
const detail = (id: string) => detailRoute(adminReq(`/api/admin/pedidos/${id}`), idParams(id))
const patch = (id: string, body: unknown) =>
  patchRoute(adminReq(`/api/admin/pedidos/${id}`, { method: "PATCH", body }), idParams(id))
const registrarPago = (id: string) => pagoPOST(adminReq(`/api/admin/pedidos/${id}/pago`, { method: "POST" }), idParams(id))
const anularPago = (id: string) => pagoDELETE(adminReq(`/api/admin/pedidos/${id}/pago`, { method: "DELETE" }), idParams(id))

async function eventosDe(orderId: string): Promise<ShopOrderEventoRow[]> {
  return getDb()
    .select()
    .from(shopOrderEventos)
    .where(eq(shopOrderEventos.orderId, orderId))
    .orderBy(shopOrderEventos.creadoEn)
}

let operatorA: string

describe("admin: historial, filtros, colas y tablero de Pedidos", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    operatorA = await seedOperator(TENANT_A, { role: "operator", name: "Ope Rador", email: "ope@example.com" })
    await seedOperator(TENANT_B, { role: "operator", name: "Ope Bee", email: "ope.b@example.com" })
    invalidateTenantRegistry()
    login(operatorA)
  })

  afterAll(async () => {
    await truncateAll()
  })

  // ───────────────────────── Historial: eventos escritos por cada acción ─────────────────────────
  describe("cambiarEstado deja rastro en shop.order_eventos", () => {
    it("un cambio normal deja UN evento 'estado' con desde/hacia y el actor del guard", async () => {
      const pedido = await seedShopOrder(TENANT_A, { estado: "pendiente" })
      const res = await patch(pedido.id, { estado: "confirmado", estadoEsperado: "pendiente" })
      expect(res.status).toBe(200)

      const eventos = await eventosDe(pedido.id)
      expect(eventos).toHaveLength(1)
      expect(eventos[0]).toMatchObject({
        tenantId: TENANT_A,
        tipo: "estado",
        detalle: { desde: "pendiente", hacia: "confirmado" },
        actorId: operatorA,
        actorNombre: "Ope Rador",
      })
    })

    it("cancelar deja DOS eventos: 'estado' (desde/hacia) y 'cancelado' (motivo), mismo actor", async () => {
      const pedido = await seedShopOrder(TENANT_A, { estado: "pendiente" })
      const res = await patch(pedido.id, { estado: "cancelado", estadoEsperado: "pendiente", motivo: "Sin stock" })
      expect(res.status).toBe(200)

      const eventos = await eventosDe(pedido.id)
      expect(eventos).toHaveLength(2)
      expect(eventos[0]).toMatchObject({ tipo: "estado", detalle: { desde: "pendiente", hacia: "cancelado" } })
      expect(eventos[1]).toMatchObject({ tipo: "cancelado", detalle: { motivo: "Sin stock" } })
      expect(eventos[0].actorId).toBe(operatorA)
      expect(eventos[1].actorId).toBe(operatorA)
    })

    it("un PATCH que no afecta filas (conflicto o 404) no inserta ningún evento", async () => {
      const pedido = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      const res = await patch(pedido.id, { estado: "cancelado", estadoEsperado: "pendiente", motivo: "x" })
      expect(res.status).toBe(409)
      expect(await eventosDe(pedido.id)).toHaveLength(0)
    })

    it("una transición inválida (422, antes del UPDATE) tampoco inserta nada", async () => {
      const pedido = await seedShopOrder(TENANT_A, { estado: "entregado" })
      const res = await patch(pedido.id, { estado: "cancelado", estadoEsperado: "entregado", motivo: "x" })
      expect(res.status).toBe(422)
      expect(await eventosDe(pedido.id)).toHaveLength(0)
    })
  })

  describe("registrarPagoManual deja un evento 'pago'", () => {
    it("registrar pago deja un evento con el estado destino y el actor", async () => {
      const pedido = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia", pagoEstado: "pendiente" })
      const res = await registrarPago(pedido.id)
      expect(res.status).toBe(200)
      const eventos = await eventosDe(pedido.id)
      expect(eventos).toHaveLength(1)
      expect(eventos[0]).toMatchObject({ tipo: "pago", detalle: { estado: "pagado" }, actorId: operatorA })
    })

    it("anular pago deja OTRO evento 'pago' con estado pendiente", async () => {
      const pedido = await seedShopOrder(TENANT_A, { pagoMetodo: "efectivo", pagoEstado: "pagado" })
      const res = await anularPago(pedido.id)
      expect(res.status).toBe(200)
      const eventos = await eventosDe(pedido.id)
      expect(eventos).toHaveLength(1)
      expect(eventos[0]).toMatchObject({ tipo: "pago", detalle: { estado: "pendiente" } })
    })

    it("repetir un registro ya hecho (idempotente) NO agrega un segundo evento", async () => {
      const pedido = await seedShopOrder(TENANT_A, { pagoMetodo: "efectivo", pagoEstado: "pagado" })
      const res = await registrarPago(pedido.id) // ya estaba pagado: idempotente, cambio:false
      expect(res.status).toBe(200)
      expect(await eventosDe(pedido.id)).toHaveLength(0)
    })
  })

  // ───────────────────────── Historial: DTO con orden y "creado" derivado ─────────────────────────
  describe("el detalle expone `historial` desc, con 'creado' al final", () => {
    it("un pedido nuevo sin eventos propios sólo tiene 'creado'", async () => {
      const pedido = await seedShopOrder(TENANT_A)
      const body = await (await detail(pedido.id)).json()
      expect(body.historial).toHaveLength(1)
      expect(body.historial[0]).toMatchObject({ tipo: "creado", detalle: {} })
      expect(body.historial[0].en).toBe(pedido.createdAt.toISOString())
    })

    it("los eventos van del más nuevo al más viejo, y 'creado' siempre es el último", async () => {
      const pedido = await seedShopOrder(TENANT_A, { estado: "pendiente" })
      await patch(pedido.id, { estado: "confirmado", estadoEsperado: "pendiente" })
      await patch(pedido.id, { estado: "preparacion", estadoEsperado: "confirmado" })

      const body = await (await detail(pedido.id)).json()
      const tipos = body.historial.map((e: { tipo: string }) => e.tipo)
      expect(tipos).toEqual(["estado", "estado", "creado"])
      expect(body.historial[0].detalle).toEqual({ desde: "confirmado", hacia: "preparacion" })
      expect(body.historial[1].detalle).toEqual({ desde: "pendiente", hacia: "confirmado" })
      // Órden cronológico descendente real, no sólo por tipo.
      const fechas = body.historial.map((e: { en: string }) => new Date(e.en).getTime())
      expect(fechas).toEqual([...fechas].sort((a, b) => b - a))
    })
  })

  // ───────────────────────── Backfill (migración 0020 del Shop) ─────────────────────────
  describe("backfill de la migración 0020: reconstruye lo que las columnas resumen permiten", () => {
    // Se ejecutan los MISMOS statements INSERT de la migración real contra filas sembradas a
    // mano con auditoría vieja (como si fueran anteriores a esta migración, sin evento propio),
    // para probar el SQL de la migración, no una reimplementación en TypeScript.
    function inserts(): string[] {
      const ruta = fileURLToPath(new URL("../../../clientes/drizzle/0020_order_eventos.sql", import.meta.url))
      const sqlTexto = readFileSync(ruta, "utf8")
      return sqlTexto
        .split("--> statement-breakpoint")
        // Cada statement puede traer comentarios de línea (`-- ...`) pegados adelante (sin su
        // propio breakpoint): se limpian antes de mirar con qué arranca el SQL de verdad.
        .map((s) =>
          s
            .split("\n")
            .filter((linea) => !linea.trim().startsWith("--"))
            .join("\n")
            .trim(),
        )
        .filter((s) => s.toUpperCase().startsWith("INSERT INTO"))
    }

    async function correrBackfill() {
      for (const stmt of inserts()) await getDb().execute(sql.raw(stmt))
    }

    it("backfillea 'estado', 'cancelado', 'pago' y 'factura_vinculada' desde las columnas resumen", async () => {
      const pedido = await seedShopOrder(TENANT_A, {
        estado: "cancelado",
        cancelacionMotivo: "Motivo viejo",
        estadoActualizadoEn: new Date("2026-01-01T10:00:00Z"),
        estadoActualizadoPor: operatorA,
        estadoActualizadoPorNombre: "Ope Rador",
        pagoEstado: "pagado",
        pagoActualizadoEn: new Date("2026-01-01T09:00:00Z"),
        pagoRegistradoPor: operatorA,
        pagoRegistradoPorNombre: "Ope Rador",
        facturaAlegraId: "999",
        facturaNumero: "A-0001-00000123",
        facturadoEn: new Date("2026-01-01T08:00:00Z"),
        facturadoPor: operatorA,
        facturadoPorNombre: "Ope Rador",
      })
      // Pre-condición: sin backfillear, no hay eventos (los inserts del repo no corrieron acá).
      expect(await eventosDe(pedido.id)).toHaveLength(0)

      await correrBackfill()

      const eventos = await eventosDe(pedido.id)
      const porTipo = (t: string) => eventos.filter((e) => e.tipo === t)
      expect(porTipo("estado")).toHaveLength(1)
      expect(porTipo("estado")[0].detalle).toEqual({ desde: null, hacia: "cancelado" })
      expect(porTipo("cancelado")).toHaveLength(1)
      expect(porTipo("cancelado")[0].detalle).toEqual({ motivo: "Motivo viejo" })
      expect(porTipo("pago")).toHaveLength(1)
      expect(porTipo("pago")[0].detalle).toEqual({ estado: "pagado" })
      expect(porTipo("factura_vinculada")).toHaveLength(1)
      expect(porTipo("factura_vinculada")[0].detalle).toEqual({ numero: "A-0001-00000123" })
      for (const e of eventos) expect(e.actorId).toBe(operatorA)
    })

    it("un pedido sin auditoría vieja (nunca tocado) no backfillea ningún evento", async () => {
      const pedido = await seedShopOrder(TENANT_A)
      await correrBackfill()
      expect(await eventosDe(pedido.id)).toHaveLength(0)
    })

    it("un pago online (sin actor) backfillea el evento 'pago' con actor null", async () => {
      const pedido = await seedShopOrder(TENANT_A, {
        pagoMetodo: "mercadopago",
        pagoProveedor: "mercadopago",
        pagoEstado: "pagado",
        pagoActualizadoEn: new Date("2026-01-01T09:00:00Z"),
        // pagoRegistradoPor queda null: lo movió el webhook, no un operador.
      })
      await correrBackfill()
      const eventos = await eventosDe(pedido.id)
      expect(eventos).toHaveLength(1)
      expect(eventos[0]).toMatchObject({ tipo: "pago", actorId: null, actorNombre: null })
    })
  })

  // ───────────────────────── Listado: búsqueda y filtros ─────────────────────────
  describe("GET /api/admin/pedidos: q, entrega, pago", () => {
    it("q por número (con o sin PED-/ceros) matchea el pedido", async () => {
      const pedido = await seedShopOrder(TENANT_A)
      const cuatroDigitos = String(pedido.numero)
      const cuerpo1 = await (await list(`?q=${cuatroDigitos}`)).json()
      expect(cuerpo1.items.map((i: { id: string }) => i.id)).toEqual([pedido.id])

      const numeroFormateado = `PED-${String(pedido.numero).padStart(8, "0")}`
      const cuerpo2 = await (await list(`?q=${encodeURIComponent(numeroFormateado)}`)).json()
      expect(cuerpo2.items.map((i: { id: string }) => i.id)).toEqual([pedido.id])
    })

    it("q por nombre de contacto, razón social o email (con unaccent)", async () => {
      const p1 = await seedShopOrder(TENANT_A, { contactoNombre: "María José Pérez" })
      const p2 = await seedShopOrder(TENANT_A, { clienteRazonSocial: "Ferretería Ejemplo SA" })
      const p3 = await seedShopOrder(TENANT_A, { clienteEmail: "compras@cliente.example" })

      expect((await (await list("?q=maria jose")).json()).items.map((i: { id: string }) => i.id)).toEqual([p1.id])
      expect((await (await list("?q=ferreteria")).json()).items.map((i: { id: string }) => i.id)).toEqual([p2.id])
      expect((await (await list("?q=compras@cliente")).json()).items.map((i: { id: string }) => i.id)).toEqual([p3.id])
    })

    it("filtro por entrega y por pago, combinables", async () => {
      const retiroPagado = await seedShopOrder(TENANT_A, { entregaTipo: "retiro", pagoEstado: "pagado" })
      await seedShopOrder(TENANT_A, { entregaTipo: "envio", pagoEstado: "pagado" })
      await seedShopOrder(TENANT_A, { entregaTipo: "retiro", pagoEstado: "pendiente" })

      const porEntrega = await (await list("?entrega=retiro")).json()
      expect(porEntrega.total).toBe(2)

      const combinado = await (await list("?entrega=retiro&pago=pagado")).json()
      expect(combinado.items.map((i: { id: string }) => i.id)).toEqual([retiroPagado.id])
    })

    it.each([
      ["?entrega=aereo", "El filtro de entrega es inválido"],
      ["?pago=parcial", "El filtro de pago es inválido"],
      ["?cola=otra", "La cola indicada no es válida"],
      ["?vista=otra", "La vista indicada no es válida"],
      [`?q=${"x".repeat(121)}`, "La búsqueda es demasiado larga"],
    ])("parámetro inválido %s → 400", async (query, error) => {
      const res = await list(query)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error, code: "invalid" })
    })
  })

  // ───────────────────────── Listado: colas ─────────────────────────
  describe("GET /api/admin/pedidos: colas", () => {
    it("cuenta cada cola sin importar los filtros activos, y filtra por cola con ?cola=", async () => {
      const sinConfirmar = await seedShopOrder(TENANT_A, { estado: "pendiente" })
      const conPago = await seedShopOrder(TENANT_A, { estado: "confirmado", pagoRevision: "cobro_duplicado" })
      const conDatos = await seedShopOrder(TENANT_A, { estado: "confirmado", requiereRevision: true })
      const sinFactura = await seedShopOrder(TENANT_A, { estado: "entregado", facturadoEn: null })
      await seedShopOrder(TENANT_A, { estado: "confirmado" }) // "normal", no entra en ninguna cola

      // Con un filtro puesto (estado=confirmado) `colas` sigue contando el tenant ENTERO.
      const body = await (await list("?estado=confirmado")).json()
      expect(body.colas).toEqual({ sin_confirmar: 1, pago: 1, datos: 1, sin_factura: 1, sin_contactar: 0 })

      expect((await (await list("?cola=sin_confirmar")).json()).items.map((i: { id: string }) => i.id)).toEqual([
        sinConfirmar.id,
      ])
      expect((await (await list("?cola=pago")).json()).items.map((i: { id: string }) => i.id)).toEqual([conPago.id])
      expect((await (await list("?cola=datos")).json()).items.map((i: { id: string }) => i.id)).toEqual([conDatos.id])
      expect((await (await list("?cola=sin_factura")).json()).items.map((i: { id: string }) => i.id)).toEqual([
        sinFactura.id,
      ])
    })

    it("un pedido cancelado con requiere_revision no cuenta en la cola 'datos'", async () => {
      await seedShopOrder(TENANT_A, {
        estado: "cancelado",
        cancelacionMotivo: "x",
        requiereRevision: true,
      })
      const body = await (await list()).json()
      expect(body.colas.datos).toBe(0)
    })

    it("aislamiento: las colas de un tenant no cuentan pedidos de otro", async () => {
      await seedShopOrder(TENANT_A, { estado: "pendiente" })
      await seedShopOrder(TENANT_B, { estado: "pendiente" })
      await seedShopOrder(TENANT_B, { estado: "pendiente" })
      const body = await (await list()).json()
      expect(body.colas.sin_confirmar).toBe(1)
    })
  })

  // ───────────────────────── Listado: vista=tablero ─────────────────────────
  describe("GET /api/admin/pedidos?vista=tablero", () => {
    it("excluye cancelados, incluye entregados recientes y excluye entregados viejos", async () => {
      const activo = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      const entregadoReciente = await seedShopOrder(TENANT_A, {
        estado: "entregado",
        estadoActualizadoEn: new Date(Date.now() - 2 * 24 * 60 * 60_000),
      })
      await seedShopOrder(TENANT_A, {
        estado: "entregado",
        estadoActualizadoEn: new Date(Date.now() - 10 * 24 * 60 * 60_000),
      })
      await seedShopOrder(TENANT_A, { estado: "cancelado", cancelacionMotivo: "x" })

      const body = await (await list("?vista=tablero")).json()
      const ids = body.items.map((i: { id: string }) => i.id).sort()
      expect(ids).toEqual([activo.id, entregadoReciente.id].sort())
    })

    it("no pagina: ignora start/limit", async () => {
      for (let i = 0; i < 3; i++) await seedShopOrder(TENANT_A, { estado: "confirmado" })
      const body = await (await list("?vista=tablero&start=1&limit=1")).json()
      expect(body.items).toHaveLength(3)
    })
  })
})
