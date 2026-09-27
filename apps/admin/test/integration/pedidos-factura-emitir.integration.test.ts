import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest"
import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { shopOrders } from "@/db/shop-schema"
import { __clearNumberTemplatesCache } from "@/lib/alegra"
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

const { GET } = await import("@/app/api/admin/pedidos/[id]/factura/emitir/route")

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
