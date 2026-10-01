import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { shopOrders, type ShopOrderRow } from "@/db/shop-schema"
import { reservaStock } from "@/lib/pedidos-repo"
import { seedShopOrder, seedShopOrderItem, seedTenant, truncateAll } from "./helpers"

// Semántica de la vista `shop.stock_reservado_sucursal` (0024 del Shop, recreada por la 0025) contra
// Postgres real, y que `reservaStock()` del CRM (el indicador "apartando stock" del detalle) la
// espeja caso por caso. El global-setup aplica las migraciones REALES del Shop del mismo checkout.
// Change `sucursales-igz-mdp`, rebanada B (hallazgos C1-C3 de la verificación). Datos inventados.

const T1 = "tenant-a"
const T2 = "tenant-b"
const HORA = 60 * 60_000
const DIA = 24 * HORA

type Reservado = Record<string, number>

/** `sucursal:ítem` → unidades reservadas, según la vista por sucursal. */
async function vista(tenantId: string): Promise<Reservado> {
  const filas = (await getDb().execute(
    sql`select sucursal, alegra_item_id, qty from shop.stock_reservado_sucursal where tenant_id = ${tenantId}`,
  )) as unknown as { sucursal: string; alegra_item_id: string; qty: string }[]
  return Object.fromEntries(filas.map((f) => [`${f.sucursal}:${f.alegra_item_id}`, Number(f.qty)]))
}

/** Ítems reservados según la vista 0012 (sin sucursal). */
async function vista0012(tenantId: string): Promise<string[]> {
  const filas = (await getDb().execute(
    sql`select alegra_item_id from shop.stock_reservado where tenant_id = ${tenantId}`,
  )) as unknown as { alegra_item_id: string }[]
  return filas.map((f) => f.alegra_item_id)
}

/** Relee el pedido tal como lo ve el CRM (con `infinity` ya parseado por el driver). */
async function releer(o: ShopOrderRow): Promise<ShopOrderRow> {
  const [row] = await getDb()
    .select()
    .from(shopOrders)
    .where(and(eq(shopOrders.id, o.id), eq(shopOrders.tenantId, o.tenantId)))
  return row
}

interface Caso {
  nombre: string
  over: Parameters<typeof seedShopOrder>[1]
  /** true = `reserva_vence_en = 'infinity'` (no se puede sembrar con un Date). */
  infinito?: boolean
  reserva: boolean
}

const ahora = () => Date.now()
const casos = (): Caso[] => [
  { nombre: "pendiente con vencimiento vigente", over: { reservaVenceEn: new Date(ahora() + DIA) }, reserva: true },
  { nombre: "pendiente con vencimiento vencido", over: { reservaVenceEn: new Date(ahora() - HORA) }, reserva: false },
  { nombre: "pendiente NULL creado hace 2 h (24 h desde created_at)", over: { createdAt: new Date(ahora() - 2 * HORA) }, reserva: true },
  { nombre: "pendiente NULL creado hace 25 h (24 h desde created_at)", over: { createdAt: new Date(ahora() - 25 * HORA) }, reserva: false },
  { nombre: "pendiente infinity creado hace 30 días (nunca vence)", over: { createdAt: new Date(ahora() - 30 * DIA) }, infinito: true, reserva: true },
  { nombre: "pendiente pagado con vencimiento vencido", over: { pagoEstado: "pagado", reservaVenceEn: new Date(ahora() - HORA) }, reserva: true },
  { nombre: "confirmado", over: { estado: "confirmado" }, reserva: true },
  { nombre: "preparación", over: { estado: "preparacion" }, reserva: true },
  { nombre: "en camino", over: { estado: "en_camino" }, reserva: true },
  { nombre: "confirmado con vencimiento vencido (no depende del vencimiento)", over: { estado: "confirmado", reservaVenceEn: new Date(ahora() - DIA) }, reserva: true },
  { nombre: "confirmado facturado (misma cuenta)", over: { estado: "confirmado", facturadoEn: new Date() }, reserva: false },
  { nombre: "pendiente facturado", over: { facturadoEn: new Date(), reservaVenceEn: new Date(ahora() + DIA) }, reserva: false },
  { nombre: "facturado con factura_cruzada", over: { estado: "preparacion", facturadoEn: new Date(), facturaCruzada: true }, reserva: true },
  { nombre: "entregado", over: { estado: "entregado" }, reserva: false },
  { nombre: "entregado con factura_cruzada", over: { estado: "entregado", facturadoEn: new Date(), facturaCruzada: true }, reserva: false },
  { nombre: "cancelado", over: { estado: "cancelado", cancelacionMotivo: "Motivo" }, reserva: false },
]

describe("shop.stock_reservado_sucursal (0025 del Shop) y reservaStock() del CRM", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T1)
    await seedTenant(T2)
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("cada caso reserva (o no) en la vista y reservaStock() coincide", async () => {
    for (const [i, c] of casos().entries()) {
      const o = await seedShopOrder(T1, { sucursal: "igz", ...c.over })
      if (c.infinito) await getDb().execute(sql`update shop.orders set reserva_vence_en = 'infinity' where id = ${o.id}::uuid`)
      await seedShopOrderItem(o.id, { alegraItemId: `caso-${i}`, qty: "1.000" })
      const enVista = `igz:caso-${i}` in (await vista(T1))
      expect(enVista, `vista, caso «${c.nombre}»`).toBe(c.reserva)
      expect(reservaStock(await releer(o)), `reservaStock(), caso «${c.nombre}»`).toBe(c.reserva)
    }
  })

  it("una línea 'a traer' reserva en la otra sucursal; el resto, en la que despacha; se suma por sucursal e ítem", async () => {
    const p1 = await seedShopOrder(T1, { sucursal: "igz", estado: "confirmado" })
    await seedShopOrderItem(p1.id, { alegraItemId: "A", qty: "2.000" })
    await seedShopOrderItem(p1.id, { alegraItemId: "B", qty: "1.000", aTraerDe: "mdp" })
    const p2 = await seedShopOrder(T1, { sucursal: "mdp", estado: "en_camino" })
    await seedShopOrderItem(p2.id, { alegraItemId: "B", qty: "3.000" })
    const p3 = await seedShopOrder(T1, { sucursal: "igz", estado: "confirmado" })
    await seedShopOrderItem(p3.id, { alegraItemId: "A", qty: "4.000" })
    expect(await vista(T1)).toEqual({ "igz:A": 6, "mdp:B": 4 })
  })

  it("cada tenant ve lo suyo", async () => {
    const a = await seedShopOrder(T1, { sucursal: "igz", estado: "confirmado" })
    await seedShopOrderItem(a.id, { alegraItemId: "A", qty: "1.000" })
    const b = await seedShopOrder(T2, { sucursal: "igz", estado: "confirmado" })
    await seedShopOrderItem(b.id, { alegraItemId: "A", qty: "5.000" })
    expect(await vista(T1)).toEqual({ "igz:A": 1 })
    expect(await vista(T2)).toEqual({ "igz:A": 5 })
  })

  it("un pedido con sucursal NULL no entra en la vista por sucursal; reservaStock() sigue la vista sin sucursal", async () => {
    const vigente = await seedShopOrder(T1, { estado: "confirmado" })
    await seedShopOrderItem(vigente.id, { alegraItemId: "sin-suc-confirmado", qty: "1.000" })
    const vencido = await seedShopOrder(T1, { createdAt: new Date(ahora() - 25 * HORA) })
    await seedShopOrderItem(vencido.id, { alegraItemId: "sin-suc-vencido", qty: "1.000" })
    const reciente = await seedShopOrder(T1, { createdAt: new Date(ahora() - 2 * HORA) })
    await seedShopOrderItem(reciente.id, { alegraItemId: "sin-suc-reciente", qty: "1.000" })
    const facturado = await seedShopOrder(T1, { estado: "confirmado", facturadoEn: new Date() })
    await seedShopOrderItem(facturado.id, { alegraItemId: "sin-suc-facturado", qty: "1.000" })

    expect(await vista(T1)).toEqual({})
    const en0012 = await vista0012(T1)
    for (const [o, item] of [
      [vigente, "sin-suc-confirmado"],
      [vencido, "sin-suc-vencido"],
      [reciente, "sin-suc-reciente"],
      [facturado, "sin-suc-facturado"],
    ] as const) {
      expect(reservaStock(await releer(o)), item).toBe(en0012.includes(item))
    }
  })
})
