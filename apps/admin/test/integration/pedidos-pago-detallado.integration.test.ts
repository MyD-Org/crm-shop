import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { paymentReceipts } from "@/db/schema"
import { shopOrderEventos, shopOrderPayments, shopOrders, type ShopOrderPaymentRow } from "@/db/shop-schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { seedOperator, seedShopOrder, seedTenant, truncateAll } from "./helpers"
import { FakeR2, seedReceipt } from "./fake-r2"

// "Registrar pago" con monto, fecha, referencia y comprobante (change
// `pago-transferencia-comprobante`, rebanada D; tabla `shop.order_payments`, 0030 del Shop).
// DB real (crm_test); sesión, mail y R2 mockeados. Datos inventados, dominio `.example`.

let session: Record<string, unknown>

const { r2Holder } = vi.hoisted(() => ({ r2Holder: { client: null as unknown as import("@/lib/r2").R2Client | null } }))

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
const sendEmail = vi.fn(async (..._args: unknown[]) => true)
vi.mock("@/lib/email", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }))
vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>()
  return { ...actual, getR2: () => r2Holder.client }
})

const { POST, DELETE } = await import("@/app/api/admin/pedidos/[id]/pago/route")
const { GET: detalleRoute } = await import("@/app/api/admin/pedidos/[id]/route")
const { GET: archivoRoute } = await import("@/app/api/admin/pedidos/[id]/comprobantes/[receiptId]/file/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"

const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://${TENANT_A}.localhost${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { host: `${TENANT_A}.localhost` },
  })
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })
const registrar = (id: string, body: unknown) => POST(req(`/api/admin/pedidos/${id}/pago`, "POST", body), idParams(id))
const anular = (id: string) => DELETE(req(`/api/admin/pedidos/${id}/pago`, "DELETE"), idParams(id))

const PAGO = { pagado: true, monto: "1210.00", fecha: "2026-09-30", referencia: "Op. 998877" }

async function pagosDe(orderId: string): Promise<ShopOrderPaymentRow[]> {
  return getDb().select().from(shopOrderPayments).where(eq(shopOrderPayments.orderId, orderId)).orderBy(shopOrderPayments.createdAt)
}
async function estadoPago(orderId: string): Promise<string> {
  const [row] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, orderId))
  return row.pagoEstado
}
async function receiptStatus(id: string): Promise<string> {
  const [row] = await getDb().select().from(paymentReceipts).where(eq(paymentReceipts.id, id))
  return row.status
}

let operatorId: string

describe("admin: registrar pago con monto, fecha, referencia y comprobante", () => {
  beforeEach(async () => {
    sendEmail.mockClear()
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    operatorId = await seedOperator(TENANT_A, { role: "operator", name: "Ope Rador", email: "ope@example.com" })
    invalidateTenantRegistry()
    session = { userId: operatorId, role: "operator", tenantId: TENANT_A, name: "Cookie", email: "c@example.com", save: async () => {} }
    r2Holder.client = new FakeR2()
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("completo: guarda el pago con actor, marca pagado, pasa el comprobante a loaded y avisa una vez", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia", estado: "confirmado" })
    const receipt = await seedReceipt(TENANT_A, null, { shopOrderId: p.id, clerkUserId: "user_1" })

    const res = await registrar(p.id, { ...PAGO, receiptId: receipt.id })
    expect(res.status).toBe(200)

    const [pago] = await pagosDe(p.id)
    expect(pago).toMatchObject({
      tenantId: TENANT_A,
      orderId: p.id,
      amount: "1210.00",
      paidOn: "2026-09-30",
      referencia: "Op. 998877",
      receiptId: receipt.id,
      registradoPor: operatorId,
      registradoPorNombre: "Ope Rador",
      anuladoEn: null,
    })
    expect(await estadoPago(p.id)).toBe("pagado")
    expect(await receiptStatus(receipt.id)).toBe("loaded")
    const [evento] = await getDb().select().from(shopOrderEventos).where(eq(shopOrderEventos.orderId, p.id))
    expect(evento).toMatchObject({ tipo: "pago", detalle: { estado: "pagado", monto: "1210.00", referencia: "Op. 998877" } })
    expect(sendEmail).toHaveBeenCalledTimes(1)

    const body = (await res.json()) as PedidoDetalleDto
    expect(body.pagos).toHaveLength(1)
    expect(body.pagos[0]).toMatchObject({ monto: 1210, fecha: "2026-09-30", referencia: "Op. 998877", receiptId: receipt.id, anulado: null })
    expect(body.comprobantes.map((c) => c.id)).toEqual([receipt.id])
  })

  it("sin comprobante: receipt_id queda NULL", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "efectivo" })
    expect((await registrar(p.id, { pagado: true, monto: "500", fecha: "2026-10-01" })).status).toBe(200)
    const [pago] = await pagosDe(p.id)
    expect(pago).toMatchObject({ receiptId: null, referencia: null, amount: "500.00" })
  })

  it("datos inválidos → 400 en usted y no crea nada", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })

    const sinMonto = await registrar(p.id, { pagado: true, monto: "0", fecha: "2026-10-01" })
    expect(sinMonto.status).toBe(400)
    expect(await sinMonto.json()).toMatchObject({ error: "Ingrese un monto mayor a cero", code: "invalid", campo: "monto" })

    const sinFecha = await registrar(p.id, { pagado: true, monto: "10" })
    expect(sinFecha.status).toBe(400)
    expect(await sinFecha.json()).toMatchObject({ error: "Indique la fecha del pago", campo: "fecha" })

    const sinCuerpo = await POST(req(`/api/admin/pedidos/${p.id}/pago`, "POST"), idParams(p.id))
    expect(sinCuerpo.status).toBe(400)

    expect(await pagosDe(p.id)).toHaveLength(0)
    expect(await estadoPago(p.id)).toBe("pendiente")
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("pedido ya pagado → 409 sin duplicar el pago, el evento ni el mail", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
    expect((await registrar(p.id, PAGO)).status).toBe(200)
    sendEmail.mockClear()

    const otra = await registrar(p.id, { ...PAGO, monto: "99.00" })
    expect(otra.status).toBe(409)
    expect(await otra.json()).toMatchObject({ code: "ya_pagado" })
    expect(await pagosDe(p.id)).toHaveLength(1)
    expect(await getDb().select().from(shopOrderEventos).where(eq(shopOrderEventos.orderId, p.id))).toHaveLength(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("comprobante de OTRO pedido, de otro tenant o rechazado → 422 y revierte todo", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
    const otroPedido = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
    const ajeno = await seedShopOrder(TENANT_B, { pagoMetodo: "transferencia" })
    const deOtroPedido = await seedReceipt(TENANT_A, null, { shopOrderId: otroPedido.id, clerkUserId: "user_2" })
    const deOtroTenant = await seedReceipt(TENANT_B, null, { shopOrderId: p.id, clerkUserId: "user_3" })
    const sinPedido = await seedReceipt(TENANT_A, "416")
    const rechazado = await seedReceipt(TENANT_A, null, { shopOrderId: p.id, clerkUserId: "user_1", status: "rejected", fileKey: null, fileMime: null })
    void ajeno

    for (const r of [deOtroPedido, deOtroTenant, sinPedido, rechazado, { id: "99999999-9999-4999-8999-999999999999" }]) {
      const res = await registrar(p.id, { ...PAGO, receiptId: r.id })
      expect(res.status).toBe(422)
      expect(await res.json()).toMatchObject({ code: "comprobante_invalido" })
    }
    expect(await pagosDe(p.id)).toHaveLength(0)
    expect(await estadoPago(p.id)).toBe("pendiente")
    expect(await receiptStatus(deOtroPedido.id)).toBe("pending")
    expect(await getDb().select().from(shopOrderEventos).where(eq(shopOrderEventos.orderId, p.id))).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("un comprobante que ya estaba loaded se acepta y queda loaded", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
    const receipt = await seedReceipt(TENANT_A, null, { shopOrderId: p.id, clerkUserId: "user_1", status: "loaded" })
    expect((await registrar(p.id, { ...PAGO, receiptId: receipt.id })).status).toBe(200)
    expect(await receiptStatus(receipt.id)).toBe("loaded")
  })

  it("anular: baja lógica del pago (queda la fila), pedido vuelve a pendiente y se puede registrar de nuevo", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
    await registrar(p.id, PAGO)

    const res = await anular(p.id)
    expect(res.status).toBe(200)
    const [pago] = await pagosDe(p.id)
    expect(pago.anuladoEn).not.toBeNull()
    expect(pago).toMatchObject({ anuladoPor: operatorId, anuladoPorNombre: "Ope Rador" })
    expect(await estadoPago(p.id)).toBe("pendiente")
    const body = (await res.json()) as PedidoDetalleDto
    expect(body.pagos).toHaveLength(1)
    expect(body.pagos[0].anulado).toMatchObject({ porNombre: "Ope Rador" })

    expect((await registrar(p.id, { ...PAGO, monto: "1210.00", referencia: "Op. 2" })).status).toBe(200)
    const pagos = await pagosDe(p.id)
    expect(pagos).toHaveLength(2)
    expect(pagos.filter((x) => x.anuladoEn === null)).toHaveLength(1)
  })

  it("anular un pago anterior a esta función (sin fila en order_payments) sigue funcionando", async () => {
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "efectivo", pagoEstado: "pagado" })
    expect((await anular(p.id)).status).toBe(200)
    expect(await estadoPago(p.id)).toBe("pendiente")
    expect(await pagosDe(p.id)).toHaveLength(0)
  })

  it("el detalle trae la cuenta congelada del pedido y los comprobantes visibles (no los rechazados ni los de otro pedido)", async () => {
    const cuenta = { v: 1, alias: "tienda.demo", cbu: "0000000000000000000000", banco: "Banco Demo", titular: "Tienda Demo SA", cuit: "30000000000", motivo: "regla" }
    const p = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia", pagoCuenta: cuenta })
    const otro = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
    const visible = await seedReceipt(TENANT_A, null, { shopOrderId: p.id, clerkUserId: "user_1", amount: "1210.00" })
    await seedReceipt(TENANT_A, null, { shopOrderId: p.id, clerkUserId: "user_1", status: "rejected", fileKey: null, fileMime: null })
    await seedReceipt(TENANT_A, null, { shopOrderId: otro.id, clerkUserId: "user_2" })

    const res = await detalleRoute(req(`/api/admin/pedidos/${p.id}`, "GET"), idParams(p.id))
    const body = (await res.json()) as PedidoDetalleDto
    expect(body.cuentaPago).toEqual({ alias: "tienda.demo", cbu: "0000000000000000000000", banco: "Banco Demo", titular: "Tienda Demo SA", cuit: "30000000000" })
    expect(body.comprobantes).toHaveLength(1)
    expect(body.comprobantes[0]).toMatchObject({ id: visible.id, monto: 1210, estado: "pending", tieneArchivo: true })

    const sinCuenta = await detalleRoute(req(`/api/admin/pedidos/${otro.id}`, "GET"), idParams(otro.id))
    expect(((await sinCuenta.json()) as PedidoDetalleDto).cuentaPago).toBeNull()
  })

  describe("GET /api/admin/pedidos/[id]/comprobantes/[receiptId]/file (un operador ve el comprobante de SU pedido)", () => {
    const fileReq = (p: string, r: string) =>
      archivoRoute(req(`/api/admin/pedidos/${p}/comprobantes/${r}/file`, "GET"), { params: Promise.resolve({ id: p, receiptId: r }) })

    it("redirige 302 a una URL firmada", async () => {
      const p = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
      const receipt = await seedReceipt(TENANT_A, null, { shopOrderId: p.id, clerkUserId: "user_1" })
      const res = await fileReq(p.id, receipt.id)
      expect(res.status).toBe(302)
      expect(res.headers.get("location")).toContain("fake-r2.test")
      expect(res.headers.get("cache-control")).toBe("private, no-store")
    })

    it("comprobante de otro pedido, de otro tenant o inexistente → 404", async () => {
      const p = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
      const otro = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
      const deOtro = await seedReceipt(TENANT_A, null, { shopOrderId: otro.id, clerkUserId: "user_2" })
      const deB = await seedReceipt(TENANT_B, null, { shopOrderId: p.id, clerkUserId: "user_3" })
      for (const id of [deOtro.id, deB.id, "99999999-9999-4999-8999-999999999999", "no-es-uuid"]) {
        expect((await fileReq(p.id, id)).status).toBe(404)
      }
    })
  })

  it("el filtro de tenant del pago: un id de pedido de otro tenant → 404", async () => {
    const ajeno = await seedShopOrder(TENANT_B, { pagoMetodo: "transferencia" })
    expect((await registrar(ajeno.id, PAGO)).status).toBe(404)
    expect(await getDb().select().from(shopOrderPayments).where(and(eq(shopOrderPayments.orderId, ajeno.id)))).toHaveLength(0)
  })
})
