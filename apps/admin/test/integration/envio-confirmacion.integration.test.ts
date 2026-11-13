import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { shopOrders } from "@/db/shop-schema"
import { cambiarEstado, registrarPagoManual } from "@/lib/pedidos-repo"
import { seedOperator, seedShopOrder, seedTenant, truncateAll } from "./helpers"

// Rebanada D del change `envio-por-zona-con-tarifa`: el CRM confirma el envío por zona (fecha real
// de entrega) al registrar un pago manual o al pasar el pedido a `confirmado`. Datos inventados.

const TENANT = "tenant-a"
const actor = { id: "00000000-0000-4000-8000-000000000001", name: "Ope Rador" }

const DETALLE = {
  v: 1,
  zona: "Zona 1",
  precio: 1210,
  regla: "poligono",
  horario: { dias: [1, 2, 3, 4, 5], horaCorte: "09:00", margenMin: 0, tz: "America/Argentina/Buenos_Aires" },
  alegra: { itemId: "env-1", ivaPct: 21 },
}

// Miércoles 2026-11-11 11:00 en Buenos Aires (UTC-3) = 14:00 UTC: después del corte de las 9 => jueves.
const MIERCOLES_11HS = new Date("2026-11-11T14:00:00Z")
// Miércoles 07:00 AR = 10:00 UTC: antes del corte => el mismo día.
const MIERCOLES_7HS = new Date("2026-11-11T10:00:00Z")

async function envioDe(id: string) {
  const [f] = await getDb()
    .select({ en: shopOrders.envioConfirmadoEn, ent: shopOrders.envioEntregaConfirmada })
    .from(shopOrders)
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, TENANT)))
  return f
}

const pagoInput = (now: Date) =>
  ({ pagado: true as const, actor, now, monto: "1210.00", fecha: "2026-11-10", referencia: null, receiptId: null })

describe("CRM: confirmación del envío por zona", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT)
    await seedOperator(TENANT, { role: "admin", name: "Ope Rador", email: "ope@example.com" })
  })
  afterAll(async () => {
    await truncateAll()
  })

  const pedidoConEnvio = (over: Record<string, unknown> = {}) =>
    seedShopOrder(TENANT, {
      entregaTipo: "envio",
      pagoMetodo: "transferencia",
      envioMetodo: "envio-en-el-dia",
      envioZona: "Zona 1",
      envioDetalle: DETALLE,
      ...over,
    })

  it("pago manual el miércoles 11:00 => entrega el jueves", async () => {
    const p = await pedidoConEnvio()
    const res = await registrarPagoManual(TENANT, p.id, pagoInput(MIERCOLES_11HS))
    expect(res.kind).toBe("ok")
    const e = await envioDe(p.id)
    expect(e.en).toEqual(MIERCOLES_11HS)
    expect(e.ent).toBe("2026-11-12")
  })

  it("anular el pago con el pedido pendiente limpia la confirmación", async () => {
    const p = await pedidoConEnvio()
    await registrarPagoManual(TENANT, p.id, pagoInput(MIERCOLES_7HS))
    expect((await envioDe(p.id)).ent).toBe("2026-11-11")
    await registrarPagoManual(TENANT, p.id, { pagado: false, actor, now: MIERCOLES_11HS })
    expect(await envioDe(p.id)).toEqual({ en: null, ent: null })
  })

  it("anular el pago con el pedido ya confirmado NO toca la confirmación", async () => {
    const p = await pedidoConEnvio()
    await registrarPagoManual(TENANT, p.id, pagoInput(MIERCOLES_7HS))
    await cambiarEstado(TENANT, p.id, { nuevo: "confirmado", esperado: "pendiente", motivo: null, actor, now: MIERCOLES_11HS })
    await registrarPagoManual(TENANT, p.id, { pagado: false, actor, now: MIERCOLES_11HS })
    expect((await envioDe(p.id)).ent).toBe("2026-11-11")
  })

  it("cuenta corriente: pasar a confirmado confirma el envío", async () => {
    const p = await pedidoConEnvio({ pagoMetodo: "cuenta_corriente" })
    const res = await cambiarEstado(TENANT, p.id, { nuevo: "confirmado", esperado: "pendiente", motivo: null, actor, now: MIERCOLES_11HS })
    expect(res.kind).toBe("ok")
    expect((await envioDe(p.id)).ent).toBe("2026-11-12")
  })

  it("el primer evento gana: confirmar después de un pago no recalcula", async () => {
    const p = await pedidoConEnvio()
    await registrarPagoManual(TENANT, p.id, pagoInput(MIERCOLES_7HS))
    await cambiarEstado(TENANT, p.id, { nuevo: "confirmado", esperado: "pendiente", motivo: null, actor, now: MIERCOLES_11HS })
    const e = await envioDe(p.id)
    expect(e.en).toEqual(MIERCOLES_7HS)
    expect(e.ent).toBe("2026-11-11")
  })

  it("pedido sin envío por zona (retiro, flag apagado): no se toca nada", async () => {
    const p = await seedShopOrder(TENANT, { pagoMetodo: "transferencia" })
    await registrarPagoManual(TENANT, p.id, pagoInput(MIERCOLES_11HS))
    await cambiarEstado(TENANT, p.id, { nuevo: "confirmado", esperado: "pendiente", motivo: null, actor, now: MIERCOLES_11HS })
    expect(await envioDe(p.id)).toEqual({ en: null, ent: null })
  })
})
