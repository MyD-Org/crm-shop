import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest"
import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { shopOrderRemitos } from "@/db/shop-schema"
import { mockAllRemisiones } from "@/lib/mock-alegra"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedOperator, seedShopOrder, seedShopOrderItem, seedTenant, truncateAll } from "./helpers"

// "Remito" (rebanada D): "Vincular remito existente" y "Emitir remito", en modo `alegraMock`
// (fixtures de mock-alegra.ts): NADA sale a la red real. Sólo admin+ (`requireAdminPlus`), a
// diferencia de "Vincular factura" que es operator+.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const { GET, POST, DELETE } = await import("@/app/api/admin/pedidos/[id]/remito/route")
const { GET: PREVIEW, POST: EMITIR } = await import("@/app/api/admin/pedidos/[id]/remito/emitir/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"
const NOT_FOUND_BODY = { error: "No encontrado", code: "not_found" }

function login(userId: string, role: "operator" | "admin" | "superadmin" = "admin") {
  session = { userId, role, tenantId: TENANT_A, name: "Cookie", email: "c@example.com", save: async () => {} }
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
  GET(req(`/api/admin/pedidos/${id}/remito?numero=${encodeURIComponent(numero)}`, { host }), idParams(id))
const vincular = (id: string, body: unknown, host?: string) =>
  POST(req(`/api/admin/pedidos/${id}/remito`, { method: "POST", body, host }), idParams(id))
const desvincular = (id: string, host?: string) =>
  DELETE(req(`/api/admin/pedidos/${id}/remito`, { method: "DELETE", host }), idParams(id))
const preview = (id: string, host?: string) => PREVIEW(req(`/api/admin/pedidos/${id}/remito/emitir`, { host }), idParams(id))
const emitir = (id: string, host?: string) =>
  EMITIR(req(`/api/admin/pedidos/${id}/remito/emitir`, { method: "POST", host }), idParams(id))

async function activarMock(tenantId: string) {
  await getDb().update(tenants).set({ alegraMock: true }).where(eq(tenants.id, tenantId))
  invalidateTenantRegistry()
}

async function remitoDeFila(orderId: string) {
  const [fila] = await getDb().select().from(shopOrderRemitos).where(eq(shopOrderRemitos.orderId, orderId))
  return fila ?? null
}

let adminA: string
let operatorA: string

describe("admin: remito de un pedido (rebanada D)", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch inesperado en test: modo alegraMock no debería tocar la red")
      }),
    )
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    await activarMock(TENANT_A)
    await activarMock(TENANT_B)
    adminA = await seedOperator(TENANT_A, { role: "admin", name: "Admin A", email: "admin@example.com" })
    operatorA = await seedOperator(TENANT_A, { role: "operator", name: "Ope Rador", email: "ope@example.com" })
    login(adminA)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await truncateAll()
  })

  describe("vincular remito existente", () => {
    it("buscar (GET) por número no guarda nada", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado", clienteCodigo: "ct-1" })
      const res = await buscar(p.id, "0001-00000512")
      expect(res.status).toBe(200)
      const body = (await res.json()) as { remision: { alegraId: string }; clienteVerificado: boolean }
      expect(body.remision.alegraId).toBe("rem-1")
      expect(body.clienteVerificado).toBe(true)
      expect(await remitoDeFila(p.id)).toBeNull()
    })

    it("enlace a otro tipo de documento (factura) → 422 con el mensaje de qué es", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      const res = await buscar(p.id, "https://app.alegra.com/invoice/view/id/7040")
      expect(res.status).toBe(422)
      expect(await res.json()).toMatchObject({ code: "remito_url_otro_documento" })
    })

    it("no existe → 422", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      expect((await buscar(p.id, "0001-99999999")).status).toBe(422)
    })

    it("vincular (POST) crea la fila y el evento del historial", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      const res = await vincular(p.id, { alegraId: "rem-1" })
      expect(res.status).toBe(200)
      const dto = (await res.json()) as PedidoDetalleDto
      expect(dto.remito).toEqual({ alegraId: "rem-1", numero: "0001-00000512", fecha: "2026-05-20" })
      expect(dto.historial.some((e) => e.tipo === "remito_vinculado")).toBe(true)
    })

    it("con un remito ya vinculado → 409, sin tocar el existente", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      await vincular(p.id, { alegraId: "rem-1" })
      const res = await vincular(p.id, { alegraId: "rem-1" })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: "ya_vinculado" })
    })

    it("cancelado → 422", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "cancelado", cancelacionMotivo: "Motivo" })
      expect((await vincular(p.id, { alegraId: "rem-1" })).status).toBe(422)
    })

    it("id inexistente en Alegra → 422; body inválido → 400", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      expect((await vincular(p.id, { alegraId: "rem-999" })).status).toBe(422)
      expect((await vincular(p.id, {})).status).toBe(400)
    })

    it("operator → 404 (mismo cuerpo que 'no encontrado')", async () => {
      login(operatorA, "operator")
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      expect((await vincular(p.id, { alegraId: "rem-1" })).status).toBe(404)
      expect(await (await vincular(p.id, { alegraId: "rem-1" })).json()).toEqual(NOT_FOUND_BODY)
    })

    it("pedido de otro tenant o id malformado → 404", async () => {
      const ajeno = await seedShopOrder(TENANT_B, { estado: "confirmado" })
      for (const id of [ajeno.id, "no-es-uuid"]) {
        expect((await vincular(id, { alegraId: "rem-1" })).status).toBe(404)
      }
    })

    it("desvincular (DELETE): borra la fila y agrega el evento", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      await vincular(p.id, { alegraId: "rem-1" })
      const res = await desvincular(p.id)
      expect(res.status).toBe(200)
      const dto = (await res.json()) as PedidoDetalleDto
      expect(dto.remito).toBeNull()
      expect(await remitoDeFila(p.id)).toBeNull()
      expect(dto.historial.some((e) => e.tipo === "remito_desvinculado")).toBe(true)
    })

    it("desvincular idempotente: sin remito → 200 sin evento de más", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
      const res = await desvincular(p.id)
      expect(res.status).toBe(200)
      expect(((await res.json()) as PedidoDetalleDto).historial.some((e) => e.tipo === "remito_desvinculado")).toBe(false)
    })
  })

  describe("emitir remito", () => {
    it("preview (GET) arma las líneas de todos los ítems, sin escribir nada", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado", clienteCodigo: "ct-1" })
      await seedShopOrderItem(p.id, { alegraItemId: "it-1", name: "Lámpara A", qty: "2.000" })
      await seedShopOrderItem(p.id, { alegraItemId: "it-2", name: "Lámpara B", qty: "1.000" })
      const res = await preview(p.id)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { lineas: { alegraItemId: string; cantidad: number }[]; avisos: string[] }
      expect(body.lineas).toHaveLength(2)
      expect(body.avisos).toEqual([])
      expect(await remitoDeFila(p.id)).toBeNull()
    })

    it("preview avisa si el pedido no tiene cliente de Alegra", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado", clienteCodigo: null })
      await seedShopOrderItem(p.id)
      const body = (await (await preview(p.id)).json()) as { avisos: string[] }
      expect(body.avisos.length).toBeGreaterThan(0)
    })

    it("emitir (POST) crea el remito en Alegra (mock) y lo persiste", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado", clienteCodigo: "ct-1" })
      await seedShopOrderItem(p.id, { alegraItemId: "it-1", qty: "3.000" })
      const antes = mockAllRemisiones().length
      const res = await emitir(p.id)
      expect(res.status).toBe(200)
      const dto = (await res.json()) as PedidoDetalleDto
      expect(dto.remito?.alegraId).toBeTruthy()
      expect(mockAllRemisiones().length).toBe(antes + 1)
      expect(dto.historial.some((e) => e.tipo === "remito_emitido")).toBe(true)
    })

    it("sin cliente de Alegra → 422 sin llamar a Alegra", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado", clienteCodigo: null })
      await seedShopOrderItem(p.id)
      const antes = mockAllRemisiones().length
      const res = await emitir(p.id)
      expect(res.status).toBe(422)
      expect(mockAllRemisiones().length).toBe(antes)
    })

    it("ya tiene remito → 409", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado", clienteCodigo: "ct-1" })
      await seedShopOrderItem(p.id)
      await emitir(p.id)
      const res = await emitir(p.id)
      expect(res.status).toBe(409)
    })

    it("cancelado → 422", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "cancelado", cancelacionMotivo: "Motivo", clienteCodigo: "ct-1" })
      await seedShopOrderItem(p.id)
      expect((await emitir(p.id)).status).toBe(422)
    })

    it("concurrencia: dos POST simultáneos crean dos remitos en Alegra pero sólo uno queda vinculado", async () => {
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado", clienteCodigo: "ct-1" })
      await seedShopOrderItem(p.id, { alegraItemId: "it-1" })
      const [r1, r2] = await Promise.all([emitir(p.id), emitir(p.id)])
      const estados = [r1.status, r2.status].sort()
      expect(estados).toEqual([200, 409])
      const fila = await remitoDeFila(p.id)
      expect(fila).not.toBeNull()
    })

    it("operator → 404", async () => {
      login(operatorA, "operator")
      const p = await seedShopOrder(TENANT_A, { estado: "confirmado", clienteCodigo: "ct-1" })
      expect((await preview(p.id)).status).toBe(404)
      expect((await emitir(p.id)).status).toBe(404)
    })
  })
})
