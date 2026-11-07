import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { getDb } from "@/db"
import { sql } from "drizzle-orm"
import { getPedido, toPedidoDetalleDto } from "@/lib/pedidos-repo"
import { seedShopOrder, seedShopOrderItem, seedTenant, truncateAll } from "./helpers"

/**
 * Stock del detalle del pedido por sucursal: el "falta" se calcula con el stock de la sucursal de la
 * que sale la línea (a_traer_de o la del pedido), no con el de la cuenta principal; y viaja el stock
 * de cada sucursal activa. Datos inventados.
 */

const A = "tenant-a"

const dto = async (id: string) => {
  const f = await getPedido(A, id)
  return toPedidoDetalleDto(f!.pedido, f!.items, f!.listaPrecios, f!.historial, f!.remito)
}

afterAll(async () => {
  await truncateAll()
})

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  const db = getDb()
  await db.execute(sql`INSERT INTO sucursales (tenant_id, slug, nombre, orden) VALUES
    (${A}, 'igz', 'Iguazú', 0), (${A}, 'mdp', 'Mar del Plata', 1)`)
  // item-1: 0 en la principal (igz) y 24 en mdp. item-2: sin fila en mdp (inventariable => 0).
  await db.execute(sql`INSERT INTO catalog_products (tenant_id, alegra_id, name, stock) VALUES
    (${A}, 'item-1', 'Velador', 0), (${A}, 'item-2', 'Base', 5)`)
  await db.execute(sql`INSERT INTO catalog_stock_sucursal (tenant_id, sucursal, alegra_id, stock, origen) VALUES
    (${A}, 'igz', 'item-1', 0, 'sync'), (${A}, 'mdp', 'item-1', 24, 'sync'), (${A}, 'igz', 'item-2', 5, 'sync')`)
})

describe("stock del detalle por sucursal", () => {
  it("con retiro en mdp usa el stock de mdp, no el de la principal", async () => {
    const p = await seedShopOrder(A, { sucursal: "mdp" })
    await seedShopOrderItem(p.id, { alegraItemId: "item-1", qty: "1.000" })
    const [i] = (await dto(p.id)).items
    expect(i.stockActual).toBe(24)
    expect(i.stockSucursales).toEqual([
      { sucursal: "igz", nombre: "Iguazú", stock: 0 },
      { sucursal: "mdp", nombre: "Mar del Plata", stock: 24 },
    ])
  })

  it("una línea que se trae de otra sucursal usa el stock de esa", async () => {
    const p = await seedShopOrder(A, { sucursal: "igz" })
    await seedShopOrderItem(p.id, { alegraItemId: "item-1", aTraerDe: "mdp" })
    expect((await dto(p.id)).items[0].stockActual).toBe(24)
  })

  it("sin fila de la sucursal, un ítem inventariable vale 0", async () => {
    const p = await seedShopOrder(A, { sucursal: "mdp" })
    await seedShopOrderItem(p.id, { alegraItemId: "item-2" })
    const [i] = (await dto(p.id)).items
    expect(i.stockActual).toBe(0)
    expect(i.stockSucursales.find((s) => s.sucursal === "mdp")?.stock).toBe(0)
  })

  it("pedido sin sucursal (viejo) sigue con el stock de catalog_products", async () => {
    const p = await seedShopOrder(A, { sucursal: null })
    await seedShopOrderItem(p.id, { alegraItemId: "item-2" })
    expect((await dto(p.id)).items[0].stockActual).toBe(5)
  })

  it("producto fuera del espejo: null y sin lista", async () => {
    const p = await seedShopOrder(A, { sucursal: "mdp" })
    await seedShopOrderItem(p.id, { alegraItemId: "no-existe" })
    const [i] = (await dto(p.id)).items
    expect(i.stockActual).toBeNull()
    expect(i.stockSucursales).toEqual([])
  })
})
