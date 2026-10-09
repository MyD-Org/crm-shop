import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { shopOrders } from "@/db/shop-schema"
import { toPedidoDto, toPagoEnLineaDto } from "@/lib/pedidos-repo"
import { seedShopOrder, seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0036 del Shop (change `listas-por-forma-de-pago`, rebanada C): `shop.orders.forma_cobro`
 * y el valor `forma_distinta` de `pago_revision`. El global-setup aplica las migraciones REALES del
 * Shop a crm_test; acá se comprueba que el CRM lee la columna y reconoce el valor nuevo. Datos
 * inventados.
 */

const T = "tenant-a"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
})
afterAll(async () => {
  await truncateAll()
})

describe("shop.orders.forma_cobro", () => {
  it("un pedido sin forma congelada se lee como null", async () => {
    const o = await seedShopOrder(T)
    expect(o.formaCobro).toBeNull()
  })

  it.each(["credito", "debito", "cuenta_mp"])("el CRM lee la forma '%s'", async (forma) => {
    const o = await seedShopOrder(T, { formaCobro: forma })
    const [fila] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, o.id))
    expect(fila.formaCobro).toBe(forma)
  })

  it("el CHECK rechaza una forma desconocida", async () => {
    await expect(seedShopOrder(T, { formaCobro: "efectivo" })).rejects.toThrow()
  })
})

describe("shop.orders.pago_revision = 'forma_distinta'", () => {
  it("el CHECK lo admite y el DTO del CRM lo conserva", async () => {
    const o = await seedShopOrder(T, { pagoRevision: "forma_distinta", formaCobro: "debito", pagoProveedor: "mercadopago" })
    const [fila] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, o.id))
    expect(toPedidoDto(fila).pagoRevision).toBe("forma_distinta")
    expect(toPagoEnLineaDto(fila)?.formaElegida).toBe("debito")
  })

  it("los valores de siempre siguen valiendo y uno desconocido lo rechaza el CHECK", async () => {
    await seedShopOrder(T, { pagoRevision: "monto_distinto" })
    await seedShopOrder(T, { pagoRevision: "cuotas_distintas" })
    await expect(seedShopOrder(T, { pagoRevision: "algo_nuevo" })).rejects.toThrow()
  })

  it("el filtro de revisión del listado incluye 'forma_distinta'", async () => {
    await seedShopOrder(T, { pagoRevision: "forma_distinta" })
    await seedShopOrder(T)
    const filas = await getDb().execute(sql`select count(*)::int as n from shop.orders where tenant_id = ${T} and pago_revision is not null`)
    expect((filas as unknown as { n: number }[])[0].n).toBe(1)
  })
})
