import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { campanias, catalogProducts, preciosOnlineConfig } from "@/db/schema"
import { seedTenant, truncateAll } from "./helpers"
import { aplicar, aplicarCampanias, seedCampania, seedLista, seedProducto, seedRegla } from "./precios-online-helpers"

// `aplicar_campanias_online` y el enganche en `aplicar_precios_online` (0095) contra Postgres real.
// Datos inventados.

const T = "tenant-camp-mat"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
})
afterAll(async () => {
  await truncateAll()
})

async function ahoraDb(): Promise<Date> {
  const [r] = (await getDb().execute(sql`SELECT now() AS n`)) as unknown as { n: Date | string }[]
  return new Date(r.n)
}
const horas = (base: Date, h: number) => new Date(base.getTime() + h * 3_600_000)

interface Entrada {
  id: string
  reglaId: string
  inicio: string
  fin: string
  pct: number
  unidades: number | null
  precios: { idPriceList: string; price: number }[]
}

async function producto(alegraId: string) {
  const [p] = await getDb()
    .select({ preciosOnline: catalogProducts.preciosOnline, campaniasOnline: catalogProducts.campaniasOnline })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, T), eq(catalogProducts.alegraId, alegraId)))
  return p as { preciosOnline: { idPriceList: string; price: number }[]; campaniasOnline: Entrada[] | null }
}

const precioDe = (lista: { idPriceList: string; price: number }[], id: string) =>
  Number(lista.find((x) => x.idPriceList === id)?.price)

describe("aplicar_campanias_online", () => {
  it("precio de campaña por lista pública sin tocar el normal", async () => {
    const ahora = await ahoraDb()
    const tarjeta = await seedLista(T, "Tarjeta cuotas", "1.6", { esReferencia: true, orden: 0 })
    const transf = await seedLista(T, "Efectivo o Transferencia", "1.3", { orden: 1 })
    await seedProducto(T, { alegraId: "1", costo: "100", brand: "acme" })
    const c = await seedCampania(T, { inicio: horas(ahora, -1), fin: horas(ahora, 24) })
    const r = await seedRegla(T, c, { tipo: "marca", marca: "acme", pct: 20 })
    await aplicar(T, null, "config")

    const p = await producto("1")
    expect(precioDe(p.preciosOnline, tarjeta)).toBe(160)
    expect(precioDe(p.preciosOnline, transf)).toBe(130)
    expect(p.campaniasOnline).toHaveLength(1)
    const e = p.campaniasOnline![0]
    expect(e).toMatchObject({ id: c, reglaId: r, pct: 20, unidades: null })
    expect(new Date(e.inicio).getTime()).toBe(horas(ahora, -1).getTime())
    expect(new Date(e.fin).getTime()).toBe(horas(ahora, 24).getTime())
    expect(precioDe(e.precios, tarjeta)).toBe(128)
    expect(precioDe(e.precios, transf)).toBe(104)
  })

  it("las listas privadas no entran al precio de campaña", async () => {
    const ahora = await ahoraDb()
    await seedLista(T, "Tarjeta cuotas", "1.6", { esReferencia: true })
    const privada = await seedLista(T, "Instaladores", "1.2", { privada: true })
    await seedProducto(T, { alegraId: "1", costo: "100", brand: "acme" })
    const c = await seedCampania(T, { inicio: horas(ahora, -1), fin: horas(ahora, 24) })
    await seedRegla(T, c, { tipo: "marca", marca: "acme", pct: 20 })
    await aplicar(T, null, "config")
    const p = await producto("1")
    expect(p.campaniasOnline![0].precios.map((x) => x.idPriceList)).not.toContain(privada)
    expect(p.campaniasOnline![0].precios).toHaveLength(1)
  })

  it("un cambio de costo (sync) recalcula el precio de campaña", async () => {
    const ahora = await ahoraDb()
    const tarjeta = await seedLista(T, "Tarjeta cuotas", "1.6", { esReferencia: true })
    const transf = await seedLista(T, "Efectivo o Transferencia", "1.3")
    await getDb().insert(preciosOnlineConfig).values({ tenantId: T, umbralRetencionPct: "100" })
    await seedProducto(T, { alegraId: "1", costo: "100", brand: "acme" })
    const c = await seedCampania(T, { inicio: horas(ahora, -1), fin: horas(ahora, 24) })
    await seedRegla(T, c, { tipo: "marca", marca: "acme", pct: 20 })
    await aplicar(T, null, "config")

    await getDb()
      .update(catalogProducts)
      .set({ costo: "200" })
      .where(and(eq(catalogProducts.tenantId, T), eq(catalogProducts.alegraId, "1")))
    await aplicar(T, null, "costo")

    const e = (await producto("1")).campaniasOnline![0]
    expect(precioDe(e.precios, tarjeta)).toBe(256)
    expect(precioDe(e.precios, transf)).toBe(208)
  })

  it("sin campañas la columna queda NULL", async () => {
    const ahora = await ahoraDb()
    await seedLista(T, "Tarjeta cuotas", "1.6", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "100", brand: "acme" })
    const c = await seedCampania(T, { inicio: horas(ahora, -1), fin: horas(ahora, 24) })
    await seedRegla(T, c, { tipo: "marca", marca: "acme", pct: 20 })
    await aplicar(T, null, "config")
    expect((await producto("1")).campaniasOnline).toHaveLength(1)

    await getDb().delete(campanias).where(eq(campanias.id, c))
    expect(await aplicarCampanias(T)).toBe(1)
    expect((await producto("1")).campaniasOnline).toBeNull()
    // Idempotente: sin cambios no reescribe.
    expect(await aplicarCampanias(T)).toBe(0)
  })

  it("un producto sin precio público no recibe campaña", async () => {
    const ahora = await ahoraDb()
    await seedLista(T, "Tarjeta cuotas", "1.6", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: null, brand: "acme" })
    const c = await seedCampania(T, { inicio: horas(ahora, -1), fin: horas(ahora, 24) })
    await seedRegla(T, c, { tipo: "marca", marca: "acme", pct: 20 })
    await aplicar(T, null, "config")
    expect((await producto("1")).campaniasOnline).toBeNull()
  })

  it("varias campañas, ordenadas por inicio, con las unidades de la regla", async () => {
    const ahora = await ahoraDb()
    await seedLista(T, "Tarjeta cuotas", "1.6", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "100", brand: "acme" })
    const despues = await seedCampania(T, { inicio: horas(ahora, 24), fin: horas(ahora, 48) })
    await seedRegla(T, despues, { tipo: "producto", alegraId: "1", pct: 30, unidades: 5 })
    const antes = await seedCampania(T, { inicio: horas(ahora, -1), fin: horas(ahora, 24) })
    await seedRegla(T, antes, { tipo: "marca", marca: "acme", pct: 10 })
    await aplicar(T, null, "config")
    const l = (await producto("1")).campaniasOnline!
    expect(l.map((e) => e.id)).toEqual([antes, despues])
    expect(l[1]).toMatchObject({ pct: 30, unidades: 5 })
    expect(Number(l[1].precios[0].price)).toBe(112)
  })

  it("redondea al centavo como round de Postgres", async () => {
    const ahora = await ahoraDb()
    const l = await seedLista(T, "Tarjeta cuotas", "1.6", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "10.01", brand: "acme" }) // 16,02 normal
    const c = await seedCampania(T, { inicio: horas(ahora, -1), fin: horas(ahora, 24) })
    await seedRegla(T, c, { tipo: "marca", marca: "acme", pct: 15 }) // 16,02 × 0,85 = 13,617
    await aplicar(T, null, "config")
    expect(precioDe((await producto("1")).campaniasOnline![0].precios, l)).toBe(13.62)
  })
})
