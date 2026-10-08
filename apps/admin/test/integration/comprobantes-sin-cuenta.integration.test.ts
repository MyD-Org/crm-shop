import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { paymentReceipts } from "@/db/schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { sendEmail } from "@/lib/email"
import { seedOperator, seedShopOrder, seedTenant, truncateAll } from "./helpers"
import { FakeR2, seedReceipt } from "./fake-r2"

// Backoffice de comprobantes con un comprobante de un comprador SIN cuenta corriente
// (codigocliente NULL desde la migración 0056, change `pago-transferencia-comprobante`, C):
// el listado y el detalle lo muestran con el pedido asociado, "Cargar en Alegra" y su contexto
// responden 409 en usted (Alegra necesita un cliente) y marcarlo cargado a mano sigue
// funcionando. DB real (crm_test); sesión, mail, R2 y fetch mockeados. Datos inventados.

let session: Record<string, unknown>

const { r2Holder, FAKE_R2_CONFIG } = vi.hoisted(() => ({
  r2Holder: { client: null as unknown as import("@/lib/r2").R2Client | null },
  FAKE_R2_CONFIG: {
    accountId: "fake-account",
    accessKeyId: "fake-key",
    secretAccessKey: "fake-secret",
    bucket: "fake-bucket",
    region: "auto",
  },
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>()
  return {
    ...actual,
    getR2: () => r2Holder.client,
    r2Config: () => (r2Holder.client ? FAKE_R2_CONFIG : null),
  }
})

const { GET: listRoute } = await import("@/app/api/admin/comprobantes/route")
const { GET: detailRoute, PATCH: patchRoute } = await import("@/app/api/admin/comprobantes/[id]/route")
const { GET: loadContextRoute } = await import("@/app/api/admin/comprobantes/[id]/load-context/route")
const { POST: loadToAlegraRoute } = await import("@/app/api/admin/comprobantes/[id]/load-to-alegra/route")
const { POST: resendRoute } = await import("@/app/api/admin/comprobantes/[id]/resend-email/route")

const TENANT_A = "tenant-a"
const MENSAJE_409 = "Este comprobante no pertenece a un cliente con cuenta corriente. Regístrelo como pago del pedido."

function loginAdmin(userId: string) {
  session = { userId, role: "admin", tenantId: TENANT_A, name: "Ana Admin", email: "ana.admin@example.com", save: async () => {} }
}

const adminReq = (path: string, init: { method?: string; body?: unknown } = {}) => {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET")
  return new NextRequest(`http://${TENANT_A}.localhost${path}`, {
    method,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { host: `${TENANT_A}.localhost` },
  })
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

const BODY_CARGA = {
  method: "transfer",
  bankAccountId: "7",
  allocations: [{ invoiceId: "101", amount: "800.00" }],
}

let fetchSpy: ReturnType<typeof vi.fn>
let receiptId: string
let pedidoId: string
let pedidoNumero: string

describe("admin: comprobante de un comprador sin cuenta corriente", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.RECEIPTS_EMAIL_FROM = "receipts@example.com"
    vi.mocked(sendEmail).mockResolvedValue(true)
    fetchSpy = vi.fn(() => Promise.reject(new Error("Alegra no debe llamarse sin cliente")))
    vi.stubGlobal("fetch", fetchSpy)
    await truncateAll()
    await seedTenant(TENANT_A, { receiptsEmail: "pagos@example.com" })
    const adminA = await seedOperator(TENANT_A, { role: "admin", name: "Ana Admin", email: "ana.admin@example.com" })
    invalidateTenantRegistry()
    r2Holder.client = new FakeR2()
    loginAdmin(adminA)

    const pedido = await seedShopOrder(TENANT_A, { pagoMetodo: "transferencia" })
    pedidoId = pedido.id
    pedidoNumero = `PED-${String(pedido.numero).padStart(8, "0")}`
    const receipt = await seedReceipt(TENANT_A, null, {
      shopOrderId: pedidoId,
      clerkUserId: "user_1",
      razonsocial: "Comprador Demo",
      cuit: "",
    })
    receiptId = receipt.id
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await truncateAll()
  })

  it("el listado lo muestra con 'sin cuenta' (codigocliente null) y el pedido con su número", async () => {
    const res = await listRoute(adminReq("/api/admin/comprobantes?status=all"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: receiptId,
      codigocliente: null,
      pedido: { id: pedidoId, numero: pedidoNumero },
    })
  })

  it("el detalle trae el mismo pedido y un comprobante clásico trae pedido null", async () => {
    const res = await detailRoute(adminReq(`/api/admin/comprobantes/${receiptId}`), idParams(receiptId))
    // Con los datos del pedido para "Registrar pago del pedido" (recién creado: sin pagar ni cancelar).
    expect((await res.json()).pedido).toMatchObject({ id: pedidoId, numero: pedidoNumero, pagado: false, cancelado: false })

    const clasico = await seedReceipt(TENANT_A, "416")
    const res2 = await detailRoute(adminReq(`/api/admin/comprobantes/${clasico.id}`), idParams(clasico.id))
    expect(await res2.json()).toMatchObject({ codigocliente: "416", pedido: null })
  })

  it("el número del pedido no se resuelve con el pedido de otro tenant", async () => {
    await seedTenant("tenant-b")
    const ajeno = await seedShopOrder("tenant-b")
    const r = await seedReceipt(TENANT_A, null, { shopOrderId: ajeno.id, clerkUserId: "user_2" })
    const res = await detailRoute(adminReq(`/api/admin/comprobantes/${r.id}`), idParams(r.id))
    // Ni número ni total: los datos del pedido de otro tenant no se leen.
    expect((await res.json()).pedido).toEqual({ id: ajeno.id, numero: null, total: null, pagado: false, cancelado: false })
  })

  it("GET load-context → 409 en usted, sin llamar a Alegra", async () => {
    const res = await loadContextRoute(adminReq(`/api/admin/comprobantes/${receiptId}/load-context`), idParams(receiptId))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: MENSAJE_409, code: "sin_cuenta_corriente" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("POST load-to-alegra → 409 en usted, sin llamar a Alegra y sin tocar la fila", async () => {
    const res = await loadToAlegraRoute(
      adminReq(`/api/admin/comprobantes/${receiptId}/load-to-alegra`, { body: BODY_CARGA }),
      idParams(receiptId),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: MENSAJE_409, code: "sin_cuenta_corriente" })
    expect(fetchSpy).not.toHaveBeenCalled()
    const [fila] = await getDb().select().from(paymentReceipts).where(eq(paymentReceipts.id, receiptId))
    expect(fila.status).toBe("pending")
    expect(fila.alegraPaymentId).toBeNull()
  })

  it("marcarlo cargado a mano sigue funcionando", async () => {
    const res = await patchRoute(
      adminReq(`/api/admin/comprobantes/${receiptId}`, { method: "PATCH", body: { status: "loaded" } }),
      idParams(receiptId),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: "loaded", codigocliente: null, pedido: { numero: pedidoNumero } })
  })

  it("el reenvío del mail sale con 'Sin cuenta corriente · Pedido …' y no falla", async () => {
    const fake = r2Holder.client as FakeR2
    const [fila] = await getDb().select().from(paymentReceipts).where(eq(paymentReceipts.id, receiptId))
    await fake.put(fila.fileKey ?? "", new Uint8Array(256).fill(0x25), { contentType: "application/pdf" })
    const res = await resendRoute(adminReq(`/api/admin/comprobantes/${receiptId}/resend-email`), idParams(receiptId))
    expect(res.status).toBe(200)
    const llamada = vi.mocked(sendEmail).mock.calls[0]
    expect(llamada?.[4]).toContain(`Sin cuenta corriente · Pedido ${pedidoNumero}`)
  })
})
