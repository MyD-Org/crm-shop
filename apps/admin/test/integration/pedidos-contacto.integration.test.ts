import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { listarPedidos, toPedidoDto } from "@/lib/pedidos-repo"
import { contactoDe, enriquecerConContacto, estadoContacto, marcarContactado } from "@/lib/pedidos-contacto-repo"
import { guardarReglasVenta } from "@/lib/reglas-venta-repo"
import { reiniciarCacheColumnasShop } from "@/lib/shop-columnas"
import { seedShopOrder, seedTenant, truncateAll } from "./helpers"

/**
 * Cola "Sin contactar" y "Marcar contactado" (change `sucursales-igz-mdp`, rebanada B).
 * Las columnas `contactado_*` son de la migración 0024 del Shop: si todavía no están en la base de
 * test se crean acá SOLO para probar (y se quitan al final); el caso "sin columnas" corre antes,
 * mientras no existen. Datos inventados.
 */

const A = "tenant-a"
const B = "tenant-b"
const ACTOR = { id: "11111111-1111-4111-8111-111111111111", name: "Ana Operadora" }

const haceHoras = (h: number) => new Date(Date.now() - h * 3_600_000)
const ids = (items: { id: string }[]) => items.map((i) => i.id).sort()

let existiaAntes = false

async function tieneColumnas(): Promise<boolean> {
  const r = await getDb().execute(
    sql`select count(*)::int as n from information_schema.columns where table_schema='shop' and table_name='orders' and column_name in ('contactado_en','contactado_por','contactado_por_nombre')`,
  )
  return Number((r[0] as { n: number }).n) === 3
}

beforeAll(async () => {
  existiaAntes = await tieneColumnas()
})

afterAll(async () => {
  await truncateAll()
  if (!existiaAntes) {
    await getDb().execute(sql`alter table shop.orders drop column if exists contactado_en, drop column if exists contactado_por, drop column if exists contactado_por_nombre`)
  }
  reiniciarCacheColumnasShop()
})

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
  reiniciarCacheColumnasShop()
})

async function crearColumnas() {
  await getDb().execute(sql`alter table shop.orders add column if not exists contactado_en timestamptz, add column if not exists contactado_por uuid, add column if not exists contactado_por_nombre text`)
  reiniciarCacheColumnasShop()
}

describe("sin las columnas del Shop", () => {
  it("degrada sin error: nada figura sin contactar y marcar responde no_disponible", async (ctx) => {
    if (existiaAntes) return ctx.skip()
    const p = await seedShopOrder(A, { createdAt: haceHoras(48) })
    expect((await estadoContacto(A)).disponible).toBe(false)
    const { colas } = await listarPedidos(A, {})
    expect(colas.sin_contactar).toBe(0)
    expect((await listarPedidos(A, { cola: "sin_contactar" })).items).toEqual([])
    expect(await marcarContactado(A, p.id, ACTOR)).toEqual({ kind: "no_disponible" })
    const r = await enriquecerConContacto(A, [{ ...toPedidoDto(p) }])
    expect(r.items[0].sinContactar).toBe(false)
  })
})

describe("con las columnas del Shop", () => {
  beforeEach(async () => {
    await crearColumnas()
  })

  it("la cola cuenta y lista solo los pendientes sin contactar pasado el umbral (default 24 h)", async () => {
    const viejo = await seedShopOrder(A, { createdAt: haceHoras(25) })
    await seedShopOrder(A, { createdAt: haceHoras(2) }) // reciente
    await seedShopOrder(A, { createdAt: haceHoras(30), estado: "confirmado" }) // no pendiente
    await seedShopOrder(A, { createdAt: haceHoras(30), estado: "cancelado", cancelacionMotivo: "x" })
    await seedShopOrder(B, { createdAt: haceHoras(99) }) // otro tenant
    const { colas } = await listarPedidos(A, {})
    expect(colas.sin_contactar).toBe(1)
    expect(ids((await listarPedidos(A, { cola: "sin_contactar" })).items)).toEqual([viejo.id])
  })

  it("el umbral sale de las reglas de venta y 0 lo apaga", async () => {
    await seedShopOrder(A, { createdAt: haceHoras(25) })
    await guardarReglasVenta(A, { avisoSinContactarHoras: 48 })
    expect((await listarPedidos(A, {})).colas.sin_contactar).toBe(0)
    await guardarReglasVenta(A, { avisoSinContactarHoras: 12 })
    expect((await listarPedidos(A, {})).colas.sin_contactar).toBe(1)
    await guardarReglasVenta(A, { avisoSinContactarHoras: 0 })
    expect((await listarPedidos(A, {})).colas.sin_contactar).toBe(0)
  })

  it("marcar contactado guarda quién y cuándo, saca al pedido de la cola y es idempotente", async () => {
    const p = await seedShopOrder(A, { createdAt: haceHoras(25) })
    const r1 = await marcarContactado(A, p.id, ACTOR)
    expect(r1.kind).toBe("ok")
    expect((await listarPedidos(A, {})).colas.sin_contactar).toBe(0)
    const c = (await contactoDe(A, [p.id])).get(p.id)
    expect(c?.contactadoPorNombre).toBe("Ana Operadora")
    expect(c?.contactadoEn).toBeInstanceOf(Date)

    const r2 = await marcarContactado(A, p.id, { id: ACTOR.id, name: "Otra Persona" })
    expect(r2.kind).toBe("ya_contactado")
    expect((await contactoDe(A, [p.id])).get(p.id)?.contactadoPorNombre).toBe("Ana Operadora")
  })

  it("no marca pedidos de otro tenant, inexistentes, con id malformado ni cancelados", async () => {
    const ajeno = await seedShopOrder(B, { createdAt: haceHoras(25) })
    expect(await marcarContactado(A, ajeno.id, ACTOR)).toEqual({ kind: "not_found" })
    expect(await marcarContactado(A, "00000000-0000-4000-8000-000000000000", ACTOR)).toEqual({ kind: "not_found" })
    expect(await marcarContactado(A, "no-es-uuid", ACTOR)).toEqual({ kind: "not_found" })
    const cancelado = await seedShopOrder(A, { estado: "cancelado", cancelacionMotivo: "x" })
    expect(await marcarContactado(A, cancelado.id, ACTOR)).toEqual({ kind: "cancelado" })
  })

  it("enriquecerConContacto marca sinContactar y trae contactadoEn del listado", async () => {
    const viejo = await seedShopOrder(A, { createdAt: haceHoras(25) })
    const contactado = await seedShopOrder(A, { createdAt: haceHoras(26) })
    await marcarContactado(A, contactado.id, ACTOR)
    const { items } = await listarPedidos(A, {})
    const r = await enriquecerConContacto(A, items.map(toPedidoDto))
    expect(r.contacto).toEqual({ disponible: true, umbralHoras: 24 })
    expect(r.items.find((i) => i.id === viejo.id)).toMatchObject({ sinContactar: true, contactadoEn: null })
    const c = r.items.find((i) => i.id === contactado.id)
    expect(c?.sinContactar).toBe(false)
    expect(c?.contactadoEn).toEqual(expect.any(String))
  })

  it("cancelar con motivo libera la reserva: el pedido cancelado sale de la vista de stock reservado", async () => {
    const p = await seedShopOrder(A, { createdAt: haceHoras(25) })
    await getDb().execute(sql`update shop.orders set estado = 'cancelado', cancelacion_motivo = 'Sin respuesta del cliente' where id = ${p.id}::uuid`)
    const filas = await getDb().execute(sql`select 1 from shop.stock_reservado where tenant_id = ${A}`)
    expect(filas.length).toBe(0)
  })
})
