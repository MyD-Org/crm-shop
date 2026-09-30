import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { getDb } from "@/db"
import { sql } from "drizzle-orm"
import { getPedido, toPedidoDetalleDto } from "@/lib/pedidos-repo"
import { extenderReserva } from "@/lib/pedidos-reserva-repo"
import { guardarReglasVenta } from "@/lib/reglas-venta-repo"
import { seedShopOrder, seedShopOrderItem, seedTenant, truncateAll } from "./helpers"

/**
 * Vencimiento y "Extender reserva" de un pendiente sin pago, y `a_traer_de` por línea (0024 del
 * Shop, change `sucursales-igz-mdp` rebanada B). Datos inventados.
 */

const A = "tenant-a"
const B = "tenant-b"
const DIA = 86_400_000

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
  await seedTenant(B)
})

describe("reserva del detalle", () => {
  it("un pendiente anterior (NULL) muestra creado + 24 h", async () => {
    const creado = new Date(Date.now() - 3_600_000)
    const p = await seedShopOrder(A, { createdAt: creado })
    expect((await dto(p.id)).reserva).toEqual({ venceEn: new Date(creado.getTime() + DIA).toISOString() })
  })

  it("muestra el snapshot y lo lee 'infinity' como sin vencimiento", async () => {
    const vence = new Date(Date.now() + 3 * DIA)
    const p = await seedShopOrder(A, { reservaVenceEn: vence })
    expect((await dto(p.id)).reserva).toEqual({ venceEn: vence.toISOString() })
    await getDb().execute(sql`update shop.orders set reserva_vence_en = 'infinity' where id = ${p.id}::uuid`)
    expect((await dto(p.id)).reserva).toEqual({ venceEn: null })
  })

  it("confirmado, pagado o facturado no dependen de un vencimiento", async () => {
    const c = await seedShopOrder(A, { estado: "confirmado" })
    const pagado = await seedShopOrder(A, { pagoEstado: "pagado" })
    expect((await dto(c.id)).reserva).toBeNull()
    expect((await dto(pagado.id)).reserva).toBeNull()
  })

  it("las líneas traen a_traer_de", async () => {
    const p = await seedShopOrder(A, { sucursal: "igz" })
    await seedShopOrderItem(p.id, { name: "A", aTraerDe: "mdp" })
    await seedShopOrderItem(p.id, { name: "B" })
    const d = await dto(p.id)
    expect(d.items.find((i) => i.name === "A")?.aTraerDe).toBe("mdp")
    expect(d.items.find((i) => i.name === "B")?.aTraerDe).toBeNull()
  })
})

describe("extenderReserva", () => {
  it("suma reserva_dias desde ahora (default 7) y devuelve el nuevo vencimiento", async () => {
    const p = await seedShopOrder(A, { createdAt: new Date(Date.now() - 10 * DIA) })
    const now = new Date("2026-09-30T12:00:00Z")
    const r = await extenderReserva(A, p.id, now)
    expect(r).toEqual({ kind: "ok", venceEn: new Date(now.getTime() + 7 * DIA) })
    expect((await dto(p.id)).reserva).toEqual({ venceEn: new Date(now.getTime() + 7 * DIA).toISOString() })
  })

  it("con reserva_dias = 0 queda sin vencimiento", async () => {
    await guardarReglasVenta(A, { reservaDias: 0 })
    const p = await seedShopOrder(A)
    expect(await extenderReserva(A, p.id)).toEqual({ kind: "ok", venceEn: null })
    expect((await dto(p.id)).reserva).toEqual({ venceEn: null })
  })

  it("no aplica a pagados, no pendientes ni facturados; no toca otro tenant ni ids inválidos", async () => {
    const pagado = await seedShopOrder(A, { pagoEstado: "pagado" })
    const conf = await seedShopOrder(A, { estado: "confirmado" })
    const ajeno = await seedShopOrder(B)
    expect(await extenderReserva(A, pagado.id)).toEqual({ kind: "no_aplica" })
    expect(await extenderReserva(A, conf.id)).toEqual({ kind: "no_aplica" })
    expect(await extenderReserva(A, ajeno.id)).toEqual({ kind: "not_found" })
    expect(await extenderReserva(A, "no-es-uuid")).toEqual({ kind: "not_found" })
    expect(await extenderReserva(A, "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "not_found" })
  })
})
