import { describe, it, expect, beforeEach, afterAll } from "vitest"
import postgres from "postgres"
import { eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { shopOrders, type ShopOrderRow } from "@/db/shop-schema"
import { reservaStock } from "@/lib/pedidos-repo"
import { TEST_DATABASE_URL } from "./db-url"
import { seedShopOrder, seedShopOrderItem, seedTenant, truncateAll } from "./helpers"

// Semántica de la vista `shop.stock_reservado` (migración 0012 del Shop) contra Postgres real,
// y la carrera de dos checkouts con `pg_advisory_xact_lock` (tarea 3.14 de
// webhooks-stock-alegra). El Shop no tiene base de test: esta suite es la única que ejecuta la
// vista. El global-setup aplica las migraciones REALES del Shop. Datos inventados.

const T1 = "tenant-a"
const T2 = "tenant-b"
const HORA = 60 * 60_000

async function reservadoPorItem(tenantId: string): Promise<Record<string, number>> {
  const filas = (await getDb().execute(
    sql`select alegra_item_id, qty from shop.stock_reservado where tenant_id = ${tenantId}`,
  )) as unknown as { alegra_item_id: string; qty: string }[]
  return Object.fromEntries(filas.map((f) => [f.alegra_item_id, Number(f.qty)]))
}

/** Pedido con una línea de `qty` unidades del ítem `item`. */
async function pedido(
  tenantId: string,
  item: string,
  qty: number,
  over: Parameters<typeof seedShopOrder>[1] = {},
): Promise<ShopOrderRow> {
  const o = await seedShopOrder(tenantId, over)
  await seedShopOrderItem(o.id, { alegraItemId: item, qty: `${qty}.000` })
  return o
}

describe("shop.stock_reservado (0012 del Shop)", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T1)
    await seedTenant(T2)
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("reservan confirmado, preparación y en camino; no entregado ni cancelado", async () => {
    await pedido(T1, "conf", 1, { estado: "confirmado" })
    await pedido(T1, "prep", 2, { estado: "preparacion" })
    await pedido(T1, "cami", 3, { estado: "en_camino" })
    await pedido(T1, "entr", 4, { estado: "entregado" })
    await pedido(T1, "canc", 5, { estado: "cancelado", cancelacionMotivo: "Motivo" })
    expect(await reservadoPorItem(T1)).toEqual({ conf: 1, prep: 2, cami: 3 })
  })

  it("pendiente: reserva 24 h desde su creación; vencido no, salvo que ya esté pagado", async () => {
    const ahora = Date.now()
    await pedido(T1, "reciente", 1, { estado: "pendiente", createdAt: new Date(ahora - 2 * HORA) })
    await pedido(T1, "casi", 1, { estado: "pendiente", createdAt: new Date(ahora - 23.5 * HORA) })
    await pedido(T1, "vencido", 1, { estado: "pendiente", createdAt: new Date(ahora - 25 * HORA) })
    await pedido(T1, "pagado", 1, { estado: "pendiente", pagoEstado: "pagado", createdAt: new Date(ahora - 25 * HORA) })
    expect(await reservadoPorItem(T1)).toEqual({ reciente: 1, casi: 1, pagado: 1 })
  })

  it("un pedido facturado no reserva aunque siga vivo; al quitar la marca vuelve", async () => {
    const o = await pedido(T1, "item-1", 2, { estado: "preparacion", facturadoEn: new Date() })
    expect(await reservadoPorItem(T1)).toEqual({})
    await getDb().update(shopOrders).set({ facturadoEn: null }).where(eq(shopOrders.id, o.id))
    expect(await reservadoPorItem(T1)).toEqual({ "item-1": 2 })
  })

  it("suma por ítem dentro del tenant, y cada tenant ve lo suyo", async () => {
    await pedido(T1, "item-1", 2, { estado: "confirmado" })
    await pedido(T1, "item-1", 3, { estado: "en_camino" })
    await pedido(T2, "item-1", 7, { estado: "confirmado" })
    expect(await reservadoPorItem(T1)).toEqual({ "item-1": 5 })
    expect(await reservadoPorItem(T2)).toEqual({ "item-1": 7 })
  })

  it("reservaStock() del detalle del CRM coincide con la vista, pedido por pedido", async () => {
    const ahora = Date.now()
    const casos: Parameters<typeof seedShopOrder>[1][] = [
      { estado: "confirmado" },
      { estado: "preparacion", facturadoEn: new Date() },
      { estado: "en_camino" },
      { estado: "entregado" },
      { estado: "cancelado", cancelacionMotivo: "Motivo" },
      { estado: "pendiente", createdAt: new Date(ahora - 2 * HORA) },
      { estado: "pendiente", createdAt: new Date(ahora - 25 * HORA) },
      { estado: "pendiente", pagoEstado: "pagado", createdAt: new Date(ahora - 25 * HORA) },
      { estado: "pendiente", facturadoEn: new Date(), createdAt: new Date(ahora - 2 * HORA) },
    ]
    for (const [i, over] of casos.entries()) {
      const o = await pedido(T1, `caso-${i}`, 1, over)
      const enVista = `caso-${i}` in (await reservadoPorItem(T1))
      expect(reservaStock(o), `caso ${i}: ${JSON.stringify(over)}`).toBe(enVista)
    }
  })
})

// ── Carrera: dos checkouts por la última unidad ────────────────────────────────────────────
// Reproduce a nivel SQL lo que hace `crearPedido` del Shop (apps/clientes/src/lib/pedidos.ts):
// dentro de la transacción toma `pg_advisory_xact_lock` por ítem (misma clave), relee el
// disponible (stock − reservado) y recién entonces escribe el pedido. Dos conexiones reales.

const STOCK = 1

async function checkout(
  db: postgres.Sql,
  item: string,
  opts: { conLock: boolean; antesDeEscribir?: () => Promise<unknown>; alTenerLock?: () => void },
): Promise<boolean> {
  return db.begin(async (tx) => {
    if (opts.conLock) {
      await tx`
        select pg_advisory_xact_lock(k) from (
          select distinct hashtextextended('shop-stock:' || ${T1} || ':' || t.id, 0) as k
          from unnest(array[${item}]::text[]) as t(id)
        ) as claves order by k`
    }
    opts.alTenerLock?.()
    const [fila] = await tx<{ qty: string | null }[]>`
      select (select qty from shop.stock_reservado where tenant_id = ${T1} and alegra_item_id = ${item}) as qty`
    const disponible = STOCK - Number(fila?.qty ?? 0)
    await opts.antesDeEscribir?.()
    if (disponible < 1) return false
    const [o] = await tx<{ id: string }[]>`
      insert into shop.orders (tenant_id, contacto_nombre, contacto_telefono, entrega_tipo, pago_metodo,
                               estado, subtotal, iva, total)
      values (${T1}, 'Carla Compradora', '+54 11 5555-0100', 'retiro', 'a_coordinar', 'confirmado', 1, 0, 1)
      returning id`
    await tx`
      insert into shop.order_items (order_id, alegra_item_id, name, qty, precio_unitario, iva_porcentaje,
                                    subtotal, iva, total)
      values (${o.id}, ${item}, 'Lámpara de prueba', 1, 1, 0, 1, 0, 1)`
    return true
  }) as Promise<boolean>
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("carrera de checkouts con pg_advisory_xact_lock", () => {
  let a: postgres.Sql
  let b: postgres.Sql

  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T1)
    a = postgres(TEST_DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
    b = postgres(TEST_DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("con el lock: la segunda transacción espera, ve la reserva de la primera y no vende", async () => {
    let primeraTieneLock!: () => void
    const lockTomado = new Promise<void>((r) => (primeraTieneLock = r))
    try {
      const primera = checkout(a, "ultima", {
        conLock: true,
        alTenerLock: () => primeraTieneLock(),
        antesDeEscribir: () => esperar(300), // la segunda llega mientras la primera tiene el lock
      })
      await lockTomado
      const segunda = checkout(b, "ultima", { conLock: true })
      expect(await Promise.all([primera, segunda])).toEqual([true, false])
      expect(await reservadoPorItem(T1)).toEqual({ ultima: 1 })
    } finally {
      await Promise.all([a.end(), b.end()])
    }
  })

  it("control, sin el lock: las dos leen antes de escribir y se sobrevende (el test detecta la carrera)", async () => {
    let leyoA!: () => void
    let leyoB!: () => void
    const ambasLeyeron = Promise.all([new Promise<void>((r) => (leyoA = r)), new Promise<void>((r) => (leyoB = r))])
    try {
      const resultados = await Promise.all([
        checkout(a, "ultima", { conLock: false, antesDeEscribir: async () => (leyoA(), await ambasLeyeron) }),
        checkout(b, "ultima", { conLock: false, antesDeEscribir: async () => (leyoB(), await ambasLeyeron) }),
      ])
      expect(resultados).toEqual([true, true])
      expect(await reservadoPorItem(T1)).toEqual({ ultima: 2 })
    } finally {
      await Promise.all([a.end(), b.end()])
    }
  })
})
