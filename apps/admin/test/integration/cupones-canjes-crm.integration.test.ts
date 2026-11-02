import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { contarCanjes, listarCanjes } from "@/lib/cupones-canjes"
import { guardarPromocion, leerPromocion } from "@/lib/cupones-repo"
import { formatearNumeroPedido, getPedido, toPedidoDetalleDto } from "@/lib/pedidos-repo"
import { PreciosOnlineError } from "@/lib/precios-online-repo"
import { seedShopOrder, seedShopOrderItem, seedTenant, truncateAll } from "./helpers"

// Canjes de cupones vistos desde el CRM (spec 2026-11-01-cupones-design.md, "CRM: pantalla
// Cupones" y "Pedido"): el estado se calcula desde el pedido con el mismo criterio que el Shop
// (pedido-vivo.ts), el doble uso de un código único se marca, y el detalle del pedido muestra la
// línea del cupón. DB real (las migraciones de las dos apps); datos inventados.

const A = "tenant-a"
const PROMO = "00000000-0000-4000-8000-00000000c001"
const actor = { id: "u1", name: "Ana", email: "ana.admin@example.com" }

let codigoId: string

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await getDb().execute(sql`
    INSERT INTO cupon_promociones (id, tenant_id, nombre, tipo, pct, inicio, fin, prefijo, creado_por)
    VALUES (${PROMO}, ${A}, 'Bot Instagram', 'unicos', 10, '2026-01-01T00:00:00-03:00', '2030-01-01T00:00:00-03:00', 'LUZ', 'test')`)
  const [c] = (await getDb().execute(sql`
    INSERT INTO cupon_codigos (promocion_id, tenant_id, codigo, origen) VALUES (${PROMO}, ${A}, 'LUZ-7KQ2M', 'integracion') RETURNING id`)) as unknown as { id: string }[]
  codigoId = c.id
})
afterAll(async () => {
  await truncateAll()
})

async function canje(orderId: string, descuento: string) {
  await getDb().execute(sql`
    INSERT INTO shop.cupon_canjes (tenant_id, codigo_id, promocion_id, order_id, clerk_user_id, email, descuento_total)
    VALUES (${A}, ${codigoId}, ${PROMO}, ${orderId}, 'user_1', 'comprador@cliente.example', ${descuento})`)
}

const ahoraMas = (h: number) => new Date(Date.now() + h * 3_600_000)

describe("canjes de una promoción", () => {
  it("estados calculados: canjeado (pagado), reservado (pendiente vivo) y liberado (cancelado)", async () => {
    const pagado = await seedShopOrder(A, { pagoEstado: "pagado", estado: "confirmado" })
    const vivo = await seedShopOrder(A, { reservaVenceEn: ahoraMas(24) })
    const cancelado = await seedShopOrder(A, { estado: "cancelado", cancelacionMotivo: "cliente" })
    await canje(pagado.id, "100.00")
    await canje(vivo.id, "50.00")
    await canje(cancelado.id, "30.00")
    const canjes = await listarCanjes(A, PROMO)
    const porPedido = Object.fromEntries(canjes.map((k) => [k.pedidoId, k]))
    expect(porPedido[pagado.id]).toMatchObject({ estado: "canjeado", duplicado: false, descuento: 100, numero: formatearNumeroPedido(pagado.numero) })
    expect(porPedido[vivo.id]).toMatchObject({ estado: "reservado", duplicado: false })
    expect(porPedido[cancelado.id]).toMatchObject({ estado: "liberado" })
    expect(await leerPromocion(A, PROMO)).toMatchObject({ canjesUsados: 1, descuentoTotal: 100 })
    expect(await getDb().transaction((tx) => contarCanjes(tx, PROMO))).toBe(3)
  })

  it("pendiente con la reserva vencida: liberado", async () => {
    const vencido = await seedShopOrder(A, { reservaVenceEn: ahoraMas(-1) })
    await canje(vencido.id, "50.00")
    expect((await listarCanjes(A, PROMO))[0].estado).toBe("liberado")
  })

  it("dos pedidos pagados con el mismo código único: los dos marcados como duplicado", async () => {
    for (const _ of [1, 2]) {
      const p = await seedShopOrder(A, { pagoEstado: "pagado" })
      await canje(p.id, "100.00")
    }
    const canjes = await listarCanjes(A, PROMO)
    expect(canjes.map((k) => k.duplicado)).toEqual([true, true])
  })

  it("con canjes reales, cambiar el % es 409 promocion_con_canjes", async () => {
    const p = await seedShopOrder(A, { reservaVenceEn: ahoraMas(24) })
    await canje(p.id, "50.00")
    const entrada = {
      nombre: "Bot Instagram", tipo: "unicos" as const, prefijo: "LUZ", pct: 15, envioGratis: false, provinciasEnvio: null,
      inicio: "2026-01-01T00:00:00-03:00", fin: "2030-01-01T00:00:00-03:00", venceDiasDesdeEmision: null, soloPrimeraCompra: true,
      minimo: null, medios: null, formas: null, permiteCuotas: false, limiteCanjes: null, condiciones: "",
    }
    const err = await guardarPromocion(A, entrada, actor, PROMO).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PreciosOnlineError)
    expect((err as PreciosOnlineError).code).toBe("promocion_con_canjes")
  })
})

describe("detalle del pedido con cupón", () => {
  it("la línea del cupón, el envío gratis por cupón y el unitario antes del cupón por línea", async () => {
    const p = await seedShopOrder(A, {
      entregaTipo: "envio",
      envioGratis: true,
      cupon: { codigoId, codigo: "LUZ-7KQ2M", promocionId: PROMO, nombre: "Bot Instagram", pct: 10, envioGratis: true, descuento: 121 },
    })
    await seedShopOrderItem(p.id, { precioUnitario: "900.00", precioSinCupon: "1000.00" })
    const r = (await getPedido(A, p.id))!
    const dto = toPedidoDetalleDto(r.pedido, r.items)
    expect(dto.cupon).toEqual({ texto: "Cupón LUZ-7KQ2M (10 %)", descuento: 121, envioGratis: true })
    expect(dto.items[0].precioSinCupon).toBe(1000)
  })

  it("sin cupón: cupon null", async () => {
    const p = await seedShopOrder(A)
    const r = (await getPedido(A, p.id))!
    expect(toPedidoDetalleDto(r.pedido, r.items).cupon).toBeNull()
  })
})
