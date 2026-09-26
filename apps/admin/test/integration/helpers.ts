import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants, adminUsers, paymentReceipts } from "@/db/schema"
import { shopOrders, shopOrderItems, type ShopOrderItemRow, type ShopOrderRow } from "@/db/shop-schema"
import { assertLocalTestDb } from "./db-url"

// Helpers compartidos por los tests de integración: siembran datos mínimos (tenant, operador)
// y limpian las tablas entre tests. getDb() usa process.env.DATABASE_URL, que el proyecto
// "integration" de vitest apunta a la DB de test.

// Doble chequeo de seguridad antes de truncar: nunca contra una DB que no sea local de test.
function guard() {
  assertLocalTestDb(process.env.DATABASE_URL || "")
}

/**
 * Vacía las tablas que tocan los tests. CASCADE limpia también las que referencian por FK.
 * Incluye `shop.order_items` y `shop.orders` (drizzle las renderiza calificadas): los pedidos
 * del Shop no cuelgan por FK de `tenants`, así que el CASCADE de arriba no los alcanza.
 * `shop.clientes` (espejo de usuarios de Clerk, 0018 del Shop) va con SQL crudo: todavía no está
 * declarada en shop-schema.ts.
 */
export async function truncateAll(): Promise<void> {
  guard()
  await getDb().execute(
    sql`truncate table ${tenants}, ${adminUsers}, ${paymentReceipts}, conversation_assignments, push_subscriptions, ${shopOrderItems}, ${shopOrders}, shop.clientes restart identity cascade`,
  )
}

export async function seedTenant(
  id = "test-tenant",
  opts: { receiptsEmail?: string } = {},
): Promise<string> {
  guard()
  await getDb()
    .insert(tenants)
    .values({
      id,
      name: "Tenant de Test",
      logoPath: "/logos/test.svg",
      resendFrom: "test@example.com",
      receiptsEmail: opts.receiptsEmail ?? "",
      // aiTenantId + aiApiUrl: las rutas que hablan con la ai-api cortan con 503 si falta
      // alguno, así que el tenant de test se siembra "configurado". La URL no se usa de
      // verdad: los tests que llegan hasta ahí mockean el cliente de inbox-api.
      aiTenantId: `ai-${id}`,
      aiApiUrl: "http://ai-api.test",
    })
    .onConflictDoNothing()
  return id
}

export async function seedOperator(
  tenantId: string,
  opts: {
    name?: string
    email?: string
    departments?: string[]
    availability?: "available" | "away"
    role?: "operator" | "admin" | "superadmin"
  } = {},
): Promise<string> {
  guard()
  const id = randomUUID()
  await getDb()
    .insert(adminUsers)
    .values({
      id,
      tenantId,
      email: opts.email ?? `op-${id}@example.com`,
      name: opts.name ?? "Operador",
      role: opts.role ?? "operator",
      departments: opts.departments ?? [],
      availability: opts.availability ?? "away",
      passwordHash: "x", // cuenta "activa" (passwordHash != null)
    })
  return id
}

/**
 * Pedido del Shop sembrado por el lado del CRM, a través del subset `shop-schema.ts`.
 * Nunca fija `numero` (GENERATED ALWAYS: lo pone la secuencia). Datos inventados.
 */
export async function seedShopOrder(
  tenantId: string,
  overrides: Partial<typeof shopOrders.$inferInsert> = {},
): Promise<ShopOrderRow> {
  guard()
  const [row] = await getDb()
    .insert(shopOrders)
    .values({
      tenantId,
      clienteEmail: "comprador@cliente.example",
      contactoNombre: "Carla Compradora",
      contactoTelefono: "+54 11 5555-0100",
      entregaTipo: "retiro",
      pagoMetodo: "a_coordinar",
      pagoEstado: "pendiente",
      estado: "pendiente",
      subtotal: "1000.00",
      iva: "210.00",
      costoEnvio: "0.00",
      total: "1210.00",
      ...overrides,
    })
    .returning()
  return row
}

export async function seedShopOrderItem(
  orderId: string,
  overrides: Partial<typeof shopOrderItems.$inferInsert> = {},
): Promise<ShopOrderItemRow> {
  guard()
  const [row] = await getDb()
    .insert(shopOrderItems)
    .values({
      orderId,
      alegraItemId: "item-1",
      code: "SKU-1",
      name: "Lámpara de prueba",
      brand: "Marca Test",
      qty: "2.000",
      precioUnitario: "500.00",
      ivaPorcentaje: "21.00",
      subtotal: "1000.00",
      iva: "210.00",
      total: "1210.00",
      ...overrides,
    })
    .returning()
  return row
}
