import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { shopOrders, type ShopOrderRow } from "@/db/shop-schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { seedOperator, seedShopOrder, seedTenant, truncateAll } from "./helpers"

// "Registrar pago" de pedidos offline contra la base real de test. El mail se intercepta en
// `sendEmail`: nada sale a Resend. Datos inventados.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
const sendEmail = vi.fn(async (..._args: unknown[]) => true)
vi.mock("@/lib/email", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }))

const { POST, DELETE } = await import("@/app/api/admin/pedidos/[id]/pago/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"

const req = (id: string, method: "POST" | "DELETE") =>
  new NextRequest(`http://${TENANT_A}.localhost/api/admin/pedidos/${id}/pago`, {
    method,
    headers: { host: `${TENANT_A}.localhost` },
  })
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })
const registrar = (id: string) => POST(req(id, "POST"), idParams(id))
const anular = (id: string) => DELETE(req(id, "DELETE"), idParams(id))

async function rowById(id: string): Promise<ShopOrderRow> {
  const [row] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, id))
  return row
}

describe("admin: registrar el pago de un pedido offline", () => {
  beforeEach(async () => {
    sendEmail.mockClear()
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    const operator = await seedOperator(TENANT_A, { role: "operator", name: "Ope Rador", email: "ope@example.com" })
    invalidateTenantRegistry()
    session = { userId: operator, role: "operator", tenantId: TENANT_A, name: "Cookie", email: "c@example.com", save: async () => {} }
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("transferencia pendiente → pagado, un solo mail aunque se repita", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia", estado: "confirmado" })
    const res = await registrar(p.id)
    expect(res.status).toBe(200)
    const body = (await res.json()) as PedidoDetalleDto
    expect(body.pagoEstado).toBe("pagado")
    expect(body.pagoManual).toBe(true)
    expect(body.pagoActualizadoEn).not.toBeNull()
    expect(body.pagoRegistradoPorNombre).toBe("Ope Rador")
    expect((await rowById(p.id)).pagoRegistradoPor).not.toBeNull()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const [, to, subject] = sendEmail.mock.calls[0] as [unknown, string, string]
    expect(to).toBe("comprador@cliente.example")
    expect(subject).toContain("pago recibido")

    expect((await registrar(p.id)).status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it("anular vuelve a pendiente sin avisar, también con el pedido cancelado", async () => {
    const p = await seedShopOrder(TENANT_A, {
      pagoMetodo: "efectivo",
      pagoEstado: "pagado",
      estado: "cancelado",
      cancelacionMotivo: "Cargado por error",
    })
    const res = await anular(p.id)
    expect(res.status).toBe(200)
    expect((await rowById(p.id)).pagoEstado).toBe("pendiente")
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("Mercado Pago → 422 y no toca nada", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "mercadopago" })
    const res = await registrar(p.id)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe("pago_online")
    expect((await rowById(p.id)).pagoEstado).toBe("pendiente")
  })

  it("pedido cancelado → 422 al registrar", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia", estado: "cancelado", cancelacionMotivo: "Sin stock" })
    const res = await registrar(p.id)
    expect(res.status).toBe(422)
    expect((await rowById(p.id)).pagoEstado).toBe("pendiente")
  })

  it("pedido de otro tenant → 404 y no lo toca", async () => {
    const p = await seedShopOrder(TENANT_B, { pagoMetodo: "transferencia" })
    expect((await registrar(p.id)).status).toBe(404)
    expect((await rowById(p.id)).pagoEstado).toBe("pendiente")
  })

  it("a coordinar también se registra a mano", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "a_coordinar" })
    expect((await registrar(p.id)).status).toBe(200)
    expect((await rowById(p.id)).pagoEstado).toBe("pagado")
  })

  it("sin email en el pedido registra igual y no manda mail", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "cuenta_corriente", clienteEmail: null })
    expect((await registrar(p.id)).status).toBe(200)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
