import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { shopOrders, type ShopOrderRow } from "@/db/shop-schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { seedOperator, seedShopOrder, seedShopOrderItem, seedTenant, truncateAll } from "./helpers"

// "Vincular factura" (change webhooks-stock-alegra, PR-3b) contra la base real de test, con
// las migraciones REALES del Shop (0011 facturado_*, 0012 stock_reservado, 0013 factura_*).
// Alegra se simula con un fetch falso por URL: nada sale a la red. Datos inventados.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const { GET, POST, DELETE } = await import("@/app/api/admin/pedidos/[id]/factura/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"
const NOT_FOUND_BODY = { error: "No encontrado", code: "not_found" }

// ── Alegra falso ──
type FacturaRaw = {
  id: number
  date: string
  total: number
  status: string
  numberTemplate: { fullNumber: string }
  client: { id: number; name: string }
}
const factura = (over: Partial<FacturaRaw> = {}): FacturaRaw => ({
  id: 7040,
  date: "2026-09-20",
  total: 1210,
  status: "open",
  numberTemplate: { fullNumber: "00201-00007040" },
  client: { id: 55, name: "Cliente Ejemplo SA" },
  ...over,
})
const alegra = {
  facturas: [] as FacturaRaw[],
  status: 200,
  llamadas: [] as string[],
}

function fakeFetch(input: unknown): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url
  if (!url.includes("api.alegra.com")) return Promise.reject(new Error(`fetch inesperado en test: ${url}`))
  const u = new URL(url)
  const path = u.pathname.replace("/api/v1", "")
  alegra.llamadas.push(`${path}${u.search}`)
  if (alegra.status !== 200) return Promise.resolve(new Response("", { status: alegra.status }))
  const porId = path.match(/^\/invoices\/(\d+)$/)
  if (porId) {
    const f = alegra.facturas.find((x) => String(x.id) === porId[1])
    return Promise.resolve(f ? Response.json(f) : new Response('{"message":"no existe"}', { status: 404 }))
  }
  if (path === "/invoices") {
    const numero = u.searchParams.get("numberTemplate_fullNumber")
    const cliente = u.searchParams.get("client_id")
    return Promise.resolve(
      Response.json(
        alegra.facturas.filter(
          (x) => (!numero || x.numberTemplate.fullNumber === numero) && (!cliente || String(x.client.id) === cliente),
        ),
      ),
    )
  }
  return Promise.reject(new Error(`ruta de Alegra inesperada en test: ${path}`))
}

function login(userId: string) {
  session = { userId, role: "operator", tenantId: TENANT_A, name: "Cookie", email: "c@example.com", save: async () => {} }
}

const req = (path: string, init: { method?: string; body?: unknown; host?: string } = {}) => {
  const host = init.host ?? TENANT_A
  return new NextRequest(`http://${host}.localhost${path}`, {
    method: init.method ?? "GET",
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { host: `${host}.localhost` },
  })
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })
const buscar = (id: string, numero: string, host?: string) =>
  GET(req(`/api/admin/pedidos/${id}/factura?numero=${encodeURIComponent(numero)}`, { host }), idParams(id))
const vincular = (id: string, body: unknown, host?: string) =>
  POST(req(`/api/admin/pedidos/${id}/factura`, { method: "POST", body, host }), idParams(id))
const desvincular = (id: string, esperada?: string, host?: string) =>
  DELETE(
    req(`/api/admin/pedidos/${id}/factura${esperada ? `?alegraId=${esperada}` : ""}`, { method: "DELETE", host }),
    idParams(id),
  )

async function rowById(id: string): Promise<ShopOrderRow> {
  const [row] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, id))
  return row
}
async function reservado(tenantId: string, itemId: string): Promise<number> {
  const filas = (await getDb().execute(
    sql`select qty from shop.stock_reservado where tenant_id = ${tenantId} and alegra_item_id = ${itemId}`,
  )) as unknown as { qty: string }[]
  return filas.length ? Number(filas[0].qty) : 0
}

let operatorA: string

describe("admin: vincular factura de Alegra a un pedido", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", vi.fn(fakeFetch))
    alegra.facturas = [factura()]
    alegra.status = 200
    alegra.llamadas = []
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    operatorA = await seedOperator(TENANT_A, { role: "operator", name: "Ope Rador", email: "ope@example.com" })
    await seedOperator(TENANT_B, { role: "operator", name: "Ope Bee", email: "ope.b@example.com" })
    invalidateTenantRegistry()
    login(operatorA)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await truncateAll()
  })

  describe("buscar (GET, no guarda nada)", () => {
    it("por número completo, pedido con el mismo cliente → factura y cliente verificado", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado", clienteCodigo: "55" })
      const res = await buscar(p.id, "00201-00007040")
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        factura: {
          alegraId: "7040",
          numero: "00201-00007040",
          fecha: "2026-09-20",
          total: 1210,
          estado: "open",
          clienteNombre: "Cliente Ejemplo SA",
        },
        clienteVerificado: true,
        otrosPedidos: [],
      })
      expect((await rowById(p.id)).facturaAlegraId).toBeNull()
    })

    it("consumidor final (sin cliente): se muestra el nombre para confirmar, sin verificar", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      const body = (await (await buscar(p.id, "00201-00007040")).json()) as Record<string, unknown>
      expect(body.clienteVerificado).toBe(false)
    })

    it("otro cliente → 422 con el nombre del cliente de la factura", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado", clienteCodigo: "56" })
      const res = await buscar(p.id, "00201-00007040")
      expect(res.status).toBe(422)
      expect(await res.json()).toMatchObject({
        code: "factura_otro_cliente",
        error: "La factura es de otro cliente (Cliente Ejemplo SA). Verifique el número.",
      })
    })

    it("borrador y anulada → 422", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      alegra.facturas = [factura({ status: "draft" })]
      expect(await (await buscar(p.id, "00201-00007040")).json()).toMatchObject({ code: "factura_borrador" })
      alegra.facturas = [factura({ status: "void" })]
      expect(await (await buscar(p.id, "00201-00007040")).json()).toMatchObject({ code: "factura_anulada" })
    })

    it("no existe → 422 factura_no_encontrada", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      const res = await buscar(p.id, "00201-00009999")
      expect(res.status).toBe(422)
      expect(await res.json()).toMatchObject({ code: "factura_no_encontrada" })
    })

    it("sólo dígitos: si no hay por número, se prueba como id", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      const res = await buscar(p.id, "7040")
      expect(res.status).toBe(200)
      expect(alegra.llamadas.at(-1)).toBe("/invoices/7040")
    })

    it("avisa si la factura ya está vinculada a otro pedido del tenant", async () => {
      const otro = await seedShopOrder(TENANT_A, {
        estado: "entregado",
        facturaAlegraId: "7040",
        facturadoEn: new Date(),
      })
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      const body = (await (await buscar(p.id, "00201-00007040")).json()) as { otrosPedidos: string[] }
      expect(body.otrosPedidos).toEqual([`PED-${String(otro.numero).padStart(8, "0")}`])
    })

    it("pedido cancelado → 422 sin consultar Alegra", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "cancelado", cancelacionMotivo: "Motivo" })
      const res = await buscar(p.id, "00201-00007040")
      expect(res.status).toBe(422)
      expect(await res.json()).toMatchObject({ code: "cancelado" })
      expect(alegra.llamadas).toEqual([])
    })

    it("Alegra 429 → 503; Alegra 500 → 502", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      alegra.status = 500
      expect((await buscar(p.id, "00201-00007040")).status).toBe(502)
      // Con 429 hay UN reintento (espera real de 1 a 1,5 s): una acción interactiva no se
      // queda esperando el cupo.
      alegra.status = 429
      alegra.llamadas = []
      expect((await buscar(p.id, "00201-00007040")).status).toBe(503)
      expect(alegra.llamadas).toHaveLength(2)
    }, 10_000)

    it("número vacío → 400", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      expect((await buscar(p.id, "  ")).status).toBe(400)
    })
  })

  describe("vincular (POST)", () => {
    it("guarda la factura, marca facturado con el actor del guard y libera la reserva; el estado no cambia", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "preparacion", clienteCodigo: "55" })
      await seedShopOrderItem(p.id, { alegraItemId: "item-9", qty: "2.000" })
      expect(await reservado(TENANT_A, "item-9")).toBe(2)

      const res = await vincular(p.id, { alegraId: "7040", facturadoPor: "00000000-0000-0000-0000-000000000000" })
      expect(res.status).toBe(200)
      const dto = (await res.json()) as PedidoDetalleDto
      expect(dto.factura).toEqual({ alegraId: "7040", numero: "00201-00007040", fecha: "2026-09-20", total: 1210 })
      expect(dto.facturadoPorNombre).toBe("Ope Rador")
      expect(dto.reservaStock).toBe(false)
      expect(dto.estado).toBe("preparacion")

      const row = await rowById(p.id)
      expect(row.facturadoPor).toBe(operatorA)
      expect(row.facturadoEn).not.toBeNull()
      expect(row.estado).toBe("preparacion")
      expect(await reservado(TENANT_A, "item-9")).toBe(0)
    })

    it("idempotente: la misma factura otra vez → 200 sin cambiar la fecha original", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      await vincular(p.id, { alegraId: "7040" })
      const primera = (await rowById(p.id)).facturadoEn
      const res = await vincular(p.id, { alegraId: "7040" })
      expect(res.status).toBe(200)
      expect((await rowById(p.id)).facturadoEn).toEqual(primera)
    })

    it("con otra factura ya vinculada → 409 y no cambia nada", async () => {
      alegra.facturas = [factura(), factura({ id: 7041, numberTemplate: { fullNumber: "00201-00007041" } })]
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      await vincular(p.id, { alegraId: "7040" })
      const res = await vincular(p.id, { alegraId: "7041" })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: "ya_vinculada" })
      expect((await rowById(p.id)).facturaAlegraId).toBe("7040")
    })

    it("revalida en Alegra: una factura anulada después de buscarla no se vincula", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      alegra.facturas = [factura({ status: "void" })]
      const res = await vincular(p.id, { alegraId: "7040" })
      expect(res.status).toBe(422)
      expect((await rowById(p.id)).facturaAlegraId).toBeNull()
    })

    it("id inexistente en Alegra → 422; body inválido → 400", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      expect((await vincular(p.id, { alegraId: "999" })).status).toBe(422)
      expect((await vincular(p.id, {})).status).toBe(400)
      expect((await vincular(p.id, { alegraId: 7040 })).status).toBe(400)
    })

    it("cancelado → 422", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "cancelado", cancelacionMotivo: "Motivo" })
      expect((await vincular(p.id, { alegraId: "7040" })).status).toBe(422)
    })

    it("pedido de otro tenant o id malformado → el mismo 404, sin tocar Alegra", async () => {
      const ajeno = await seedShopOrder(TENANT_B, { estado: "confirmado" })
      for (const id of [ajeno.id, "no-es-uuid"]) {
        const res = await vincular(id, { alegraId: "7040" })
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual(NOT_FOUND_BODY)
      }
      expect(alegra.llamadas).toEqual([])
      expect((await rowById(ajeno.id)).facturaAlegraId).toBeNull()
    })

    it("sin sesión → 401", async () => {
      session = {}
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      expect((await vincular(p.id, { alegraId: "7040" })).status).toBe(401)
    })
  })

  describe("desvincular (DELETE)", () => {
    it("borra la factura y la marca; el pedido vivo vuelve a reservar", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      await seedShopOrderItem(p.id, { alegraItemId: "item-9", qty: "3.000" })
      await vincular(p.id, { alegraId: "7040" })
      expect(await reservado(TENANT_A, "item-9")).toBe(0)

      const res = await desvincular(p.id, "7040")
      expect(res.status).toBe(200)
      const dto = (await res.json()) as PedidoDetalleDto
      expect(dto.factura).toBeNull()
      expect(dto.facturadoEn).toBeNull()
      expect(dto.reservaStock).toBe(true)
      const row = await rowById(p.id)
      expect([row.facturaNumero, row.facturaFecha, row.facturaTotal, row.facturadoPor, row.facturadoPorNombre]).toEqual([
        null,
        null,
        null,
        null,
        null,
      ])
      expect(await reservado(TENANT_A, "item-9")).toBe(3)
    })

    it("idempotente: sin factura → 200", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      expect((await desvincular(p.id)).status).toBe(200)
    })

    it("la factura en pantalla ya no es la vinculada → 409", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      await vincular(p.id, { alegraId: "7040" })
      expect((await desvincular(p.id, "1234")).status).toBe(409)
      expect((await rowById(p.id)).facturaAlegraId).toBe("7040")
    })

    it("pedido de otro tenant → 404 y no cambia", async () => {
      const ajeno = await seedShopOrder(TENANT_B, {
        estado: "confirmado",
        facturaAlegraId: "7040",
        facturadoEn: new Date(),
      })
      expect((await desvincular(ajeno.id)).status).toBe(404)
      expect((await rowById(ajeno.id)).facturaAlegraId).toBe("7040")
    })
  })

  it("la base rechaza una factura sin marca de facturado (CHECK de la 0013)", async () => {
    const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
    await expect(
      getDb().update(shopOrders).set({ facturaAlegraId: "7040" }).where(eq(shopOrders.id, p.id)),
    ).rejects.toThrow()
  })
})
