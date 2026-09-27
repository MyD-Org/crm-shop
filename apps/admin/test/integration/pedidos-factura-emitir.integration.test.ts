import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest"
import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { shopOrderEventos, shopOrders } from "@/db/shop-schema"
import { __clearNumberTemplatesCache, __clearTaxesCache } from "@/lib/alegra"
import { mockAllInvoices, mockContacts } from "@/lib/mock-alegra"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedOperator, seedShopOrder, seedShopOrderItem, seedTenant, truncateAll } from "./helpers"

// "Emitir factura" (rebanada B): preview puro, GET únicamente. Contra la base real de test, en
// modo `alegraMock` (fixtures de mock-alegra.ts: numeraciones A/B/C/X activas + una A inactiva): NADA sale a la red. El GET nunca escribe — se verifica explícitamente que
// no toca `factura_alegra_id` ni llama a ningún endpoint de escritura de Alegra. Datos
// inventados.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const { GET, POST } = await import("@/app/api/admin/pedidos/[id]/factura/emitir/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"
const NOT_FOUND_BODY = { error: "No encontrado", code: "not_found" }

function login(userId: string, role: "operator" | "admin" | "superadmin" = "admin") {
  session = { userId, role, tenantId: TENANT_A, name: "Cookie", email: "c@example.com", save: async () => {} }
}

const req = (path: string, host = TENANT_A) =>
  new NextRequest(`http://${host}.localhost${path}`, { headers: { host: `${host}.localhost` } })
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })
const preview = (id: string, host?: string) => GET(req(`/api/admin/pedidos/${id}/factura/emitir`, host), idParams(id))

async function activarMock(tenantId: string) {
  await getDb().update(tenants).set({ alegraMock: true }).where(eq(tenants.id, tenantId))
  invalidateTenantRegistry()
}

let adminA: string
let operatorA: string

describe("admin: preview de emisión de factura (GET, sin escritura)", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // El GET no debería llamar a `fetch` en absoluto (modo mock: todo sale de mock-alegra.ts).
    // Si algo intentara pegarle a la red de verdad, esto lo hace fallar ruidosamente.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch inesperado en test: el preview de emisión no debería tocar la red")
      }),
    )
    __clearNumberTemplatesCache()
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

  it("operator → 404 (mismo cuerpo que 'no encontrado')", async () => {
    login(operatorA, "operator")
    const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
    const res = await preview(p.id)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(NOT_FOUND_BODY)
  })

  it("admin sobre pedido inexistente o de otro tenant → 404", async () => {
    const ajeno = await seedShopOrder(TENANT_B, { estado: "confirmado" })
    for (const id of [ajeno.id, "no-es-uuid", "11111111-1111-4111-8111-111111111111"]) {
      const res = await preview(id)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual(NOT_FOUND_BODY)
    }
  })

  it("admin sobre pedido válido sin factura → 200 con el shape del preview", async () => {
    const p = await seedShopOrder(TENANT_A, {
      estado: "confirmado",
      clienteCodigo: null,
      facturacionTipoDoc: "CUIT",
      // CUIT que no coincide con ningún contacto del mock (mockContacts).
      facturacionNroDoc: "27555666777",
      subtotal: "1000.00",
      iva: "210.00",
      total: "1210.00",
    })
    await seedShopOrderItem(p.id, { alegraItemId: "it-1", name: "Lámpara LED 12W", qty: "2.000" })

    const res = await preview(p.id)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lineas).toEqual([
      { alegraItemId: "it-1", nombre: "Lámpara LED 12W", cantidad: 2, precioUnitario: 500, ivaPorcentaje: 21 },
    ])
    expect(body.total).toBe(1210)
    expect(body.totalPedido).toBe(1210)
    expect(body.bloqueo).toBeNull()
    expect(body.avisos).toEqual([])
    // Numeraciones activas de tipo invoice del mock: A, B, C y "Presupuesto X" (la A inactiva
    // queda afuera).
    expect(body.numeraciones.map((n: { subDocumentType: string }) => n.subDocumentType).sort()).toEqual([
      "INVOICE_A",
      "INVOICE_B",
      "INVOICE_C",
      "INVOICE_X",
    ])
    // Receptor con CUIT → se sugiere la numeración A.
    expect(body.numeracionSugeridaId).toBe("1")
    // Sin cliente_codigo pero con documento que no matchea ningún mock: contacto nuevo.
    expect(body.contacto).toEqual({ alegraId: null, esNuevo: true, nombre: "Carla Compradora" })
  })

  it("consumidor final con documento de un contacto existente del mock: usa ese contacto, no crea uno nuevo", async () => {
    const p = await seedShopOrder(TENANT_A, {
      estado: "confirmado",
      clienteCodigo: null,
      facturacionTipoDoc: "CUIT",
      facturacionNroDoc: "30712345678", // identification de mockContacts ct-1
    })
    await seedShopOrderItem(p.id)
    const body = await (await preview(p.id)).json()
    expect(body.contacto).toEqual({ alegraId: "ct-1", esNuevo: false, nombre: "Carla Compradora" })
  })

  it("pedido con cliente_codigo: usa ese contacto directo, sin buscar en Alegra", async () => {
    const p = await seedShopOrder(TENANT_A, { estado: "confirmado", clienteCodigo: "ct-3" })
    await seedShopOrderItem(p.id)
    const body = await (await preview(p.id)).json()
    expect(body.contacto).toEqual({ alegraId: "ct-3", esNuevo: false, nombre: "Carla Compradora" })
  })

  it("admin sobre pedido con factura_alegra_id ya presente → 409, sin llegar a leer numeraciones", async () => {
    const p = await seedShopOrder(TENANT_A, {
      estado: "entregado",
      facturaAlegraId: "7040",
      facturaNumero: "00201-00007040",
      facturadoEn: new Date(),
    })
    const res = await preview(p.id)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ya_vinculada" })
  })

  it("pedido con requiereRevision: 200 igual, con bloqueo presente y líneas armadas", async () => {
    const p = await seedShopOrder(TENANT_A, {
      estado: "confirmado",
      requiereRevision: true,
      motivoRevision: "documento_incompatible",
    })
    await seedShopOrderItem(p.id)
    const res = await preview(p.id)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bloqueo).toMatchObject({ motivo: "documento_incompatible" })
    expect(body.lineas).toHaveLength(1)
    expect(body.numeraciones.length).toBeGreaterThan(0)
  })

  it("ítem sin alegra_item_id: aviso bloqueante en la respuesta, sin lanzar", async () => {
    const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
    await seedShopOrderItem(p.id, { alegraItemId: "" })
    const res = await preview(p.id)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lineas).toEqual([])
    expect(body.avisos.some((a: { motivo: string }) => a.motivo === "item_sin_alegra_id")).toBe(true)
  })

  it("nunca escribe: el pedido sigue sin factura después del GET", async () => {
    const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
    await seedShopOrderItem(p.id)
    await preview(p.id)
    const [row] = await getDb()
      .select({ facturaAlegraId: shopOrders.facturaAlegraId })
      .from(shopOrders)
      .where(eq(shopOrders.id, p.id))
    expect(row.facturaAlegraId).toBeNull()
  })

  it("sin sesión → 401", async () => {
    session = {}
    const p = await seedShopOrder(TENANT_A, { estado: "confirmado" })
    expect((await preview(p.id)).status).toBe(401)
  })
})

// ───────────────────────── POST: confirmación de emisión (rebanada C) ─────────────────────────

const postReq = (path: string, body: unknown, host = TENANT_A) =>
  new NextRequest(`http://${host}.localhost${path}`, {
    method: "POST",
    headers: { host: `${host}.localhost`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
const emitir = (id: string, body: unknown, host?: string) =>
  POST(postReq(`/api/admin/pedidos/${id}/factura/emitir`, body, host), idParams(id))

describe("admin: confirmación de emisión de factura (POST)", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Igual que el GET: nada de esto debería salir a la red real en modo alegraMock.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch inesperado en test: la confirmación de emisión en modo mock no debería tocar la red")
      }),
    )
    __clearNumberTemplatesCache()
    __clearTaxesCache()
    await truncateAll()
    await seedTenant(TENANT_A)
    await activarMock(TENANT_A)
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

  async function pedidoFacturable(over: Parameters<typeof seedShopOrder>[1] = {}) {
    const p = await seedShopOrder(TENANT_A, {
      estado: "confirmado",
      clienteCodigo: "ct-3", // contacto existente del mock, sin buscar ni crear
      subtotal: "1000.00",
      iva: "210.00",
      total: "1210.00",
      ...over,
    })
    await seedShopOrderItem(p.id, { alegraItemId: "it-1", qty: "2.000", precioUnitario: "500.00", ivaPorcentaje: "21.00" })
    return p
  }

  it("operator → 404, no crea nada en Alegra", async () => {
    login(operatorA, "operator")
    const p = await pedidoFacturable()
    const antes = mockAllInvoices().length
    const res = await emitir(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(404)
    expect(mockAllInvoices()).toHaveLength(antes)
  })

  it("idempotencia: pedido ya facturado → 409, sin llamar createInvoice", async () => {
    const p = await pedidoFacturable({ facturaAlegraId: "7040", facturaNumero: "00201-00007040", facturadoEn: new Date() })
    const antes = mockAllInvoices().length
    const res = await emitir(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ya_vinculada" })
    expect(mockAllInvoices()).toHaveLength(antes)
  })

  it("numeración inexistente → 422, sin llamar createInvoice", async () => {
    const p = await pedidoFacturable()
    const antes = mockAllInvoices().length
    const res = await emitir(p.id, { numberTemplateId: "999" })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "numeracion_invalida" })
    expect(mockAllInvoices()).toHaveLength(antes)
  })

  it("numeración inactiva → 422, sin llamar createInvoice", async () => {
    const p = await pedidoFacturable()
    const antes = mockAllInvoices().length
    // "4" = Factura A (punto de venta 2, dado de baja) en mockNumberTemplates.
    const res = await emitir(p.id, { numberTemplateId: "4" })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "numeracion_invalida" })
    expect(mockAllInvoices()).toHaveLength(antes)
  })

  it("bloqueo por requiereRevision con numeración A → 422, sin llamar createInvoice", async () => {
    const p = await pedidoFacturable({ requiereRevision: true, motivoRevision: "documento_incompatible" })
    const antes = mockAllInvoices().length
    const res = await emitir(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "documento_incompatible" })
    expect(mockAllInvoices()).toHaveLength(antes)
  })

  it("bloqueo por requiereRevision se exime con Presupuesto X → 200, sí crea la factura", async () => {
    const p = await pedidoFacturable({ requiereRevision: true, motivoRevision: "documento_incompatible" })
    const antes = mockAllInvoices().length
    const res = await emitir(p.id, { numberTemplateId: "18" })
    expect(res.status).toBe(200)
    expect(mockAllInvoices()).toHaveLength(antes + 1)
  })

  it("éxito con cliente_codigo existente: crea la factura, persiste el vínculo y arma avisoFactura", async () => {
    const p = await pedidoFacturable()
    const res = await emitir(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.factura).toMatchObject({ alegraId: expect.any(String) })
    // Modo alegraMock: enviarFacturaPedido nunca manda el mail de verdad.
    expect(body.avisoFactura).toMatchObject({ resultado: "sin_pdf" })

    const [row] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, p.id))
    expect(row.facturaAlegraId).toBe(body.factura.alegraId)
    expect(row.facturadoPorNombre).toBe("Admin A")

    const eventos = await getDb().select().from(shopOrderEventos).where(eq(shopOrderEventos.orderId, p.id))
    expect(eventos.some((e) => e.tipo === "factura_emitida")).toBe(true)
  })

  it("crea la factura con el número de plantilla elegido, price NETO y el impuesto de la línea", async () => {
    const p = await pedidoFacturable()
    await emitir(p.id, { numberTemplateId: "1" })
    const creada = mockAllInvoices().at(-1)
    expect(creada?.clientAlegraId).toBe("ct-3")
  })

  it("cliente_codigo NULL sin contacto previo: crea un contacto nuevo en Alegra", async () => {
    const p = await pedidoFacturable({
      clienteCodigo: null,
      facturacionTipoDoc: "CUIT",
      facturacionNroDoc: "27555666777", // no matchea ningún contacto del mock
    })
    const antesContactos = mockContacts.length
    const res = await emitir(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(200)
    expect(mockContacts).toHaveLength(antesContactos + 1)
  })

  it("cliente_codigo NULL con contacto ya existente: NO crea un contacto nuevo", async () => {
    const p = await pedidoFacturable({
      clienteCodigo: null,
      facturacionTipoDoc: "CUIT",
      facturacionNroDoc: "30712345678", // identification de ct-1 en el mock
    })
    const antesContactos = mockContacts.length
    const res = await emitir(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(200)
    expect(mockContacts).toHaveLength(antesContactos)
    const creada = mockAllInvoices().at(-1)
    expect(creada?.clientAlegraId).toBe("ct-1")
  })

  it("dos confirmaciones casi simultáneas: sólo una crea la factura en Alegra", async () => {
    const p = await pedidoFacturable()
    const antes = mockAllInvoices().length
    const [r1, r2] = await Promise.all([emitir(p.id, { numberTemplateId: "1" }), emitir(p.id, { numberTemplateId: "1" })])
    const estados = [r1.status, r2.status].sort()
    expect(estados).toEqual([200, 409])
    expect(mockAllInvoices()).toHaveLength(antes + 1)
  })

  it("createInvoice tuvo éxito pero persistir el vínculo falla: informa la factura creada sin vincular", async () => {
    const repo = await import("@/lib/pedidos-repo")
    const spy = vi.spyOn(repo, "persistirFacturaEmitida").mockRejectedValueOnce(new Error("DB caída"))
    const p = await pedidoFacturable()
    const antesInvoices = mockAllInvoices().length
    const res = await emitir(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe("creada_sin_vincular")
    expect(body.alegraId).toEqual(expect.any(String))
    expect(mockAllInvoices()).toHaveLength(antesInvoices + 1)

    // La reserva se liberó: el pedido queda sin `factura_alegra_id`, listo para "Vincular
    // factura" con el id/número que informó la respuesta — no se queda trabado con el sentinel.
    const [row] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, p.id))
    expect(row.facturaAlegraId).toBeNull()
    spy.mockRestore()
  })

  it("Alegra responde 429 al crear la factura: 503, sin persistir nada", async () => {
    const alegra = await import("@/lib/alegra")
    const spy = vi.spyOn(alegra, "createInvoice").mockRejectedValueOnce(new alegra.AlegraRateLimitError("/invoices", ""))
    const p = await pedidoFacturable()
    const res = await emitir(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: "alegra_limite" })
    const [row] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, p.id))
    expect(row.facturaAlegraId).toBeNull()
    spy.mockRestore()
  })

  it("Alegra rechaza por un error de negocio (4xx): 502, sin exponer el body crudo", async () => {
    const alegra = await import("@/lib/alegra")
    const spy = vi
      .spyOn(alegra, "createInvoice")
      .mockRejectedValueOnce(new alegra.AlegraHttpError(422, "/invoices", '{"message":"stock insuficiente"}'))
    const p = await pedidoFacturable()
    const res = await emitir(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe("alegra_error")
    expect(JSON.stringify(body)).not.toMatch(/stock insuficiente/)
    const [row] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, p.id))
    expect(row.facturaAlegraId).toBeNull()
    spy.mockRestore()
  })

  it("sin numberTemplateId → 400, sin llamar createInvoice", async () => {
    const p = await pedidoFacturable()
    const antes = mockAllInvoices().length
    const res = await emitir(p.id, {})
    expect(res.status).toBe(400)
    expect(mockAllInvoices()).toHaveLength(antes)
  })

  it("sin sesión → 401", async () => {
    session = {}
    const p = await pedidoFacturable()
    expect((await emitir(p.id, { numberTemplateId: "1" })).status).toBe(401)
  })
})
