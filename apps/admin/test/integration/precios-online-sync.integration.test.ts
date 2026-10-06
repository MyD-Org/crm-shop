import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, catalogOverlay, catalogProducts } from "@/db/schema"
import { costoDeItem, type AlegraProduct } from "@/lib/alegra"
import { upsertProductos, upsertProductosSecundaria } from "@/lib/catalog-products-repo"
import { contarAlertas, listarRetenidos } from "@/lib/precios-online-costos"
import { seedTenant, truncateAll } from "./helpers"
import { seedLista } from "./precios-online-helpers"

// B.15–B.17: la sync y el webhook recalculan el precio online del ítem (aplican o retienen el
// costo nuevo); un fallo del recálculo no tumba la escritura; los productos nuevos llegan sin
// overlay (ocultos) y figuran como "nuevos sin revisar". Datos inventados.

const T = "tenant-po-sync"

function item(alegraId: string, unitCost: unknown, extra: Partial<AlegraProduct> = {}): AlegraProduct {
  const raw: Record<string, unknown> = { id: alegraId, inventory: unitCost === undefined ? {} : { unitCost } }
  return {
    alegraId,
    code: `REF-${alegraId}`,
    name: `Producto ${alegraId}`,
    description: null,
    categoryAlegraId: null,
    prices: [],
    stock: 1,
    status: "active",
    images: [],
    brand: null,
    ivaPorcentaje: 21,
    costo: costoDeItem(raw),
    raw,
    ...extra,
  }
}

const fila = async (alegraId: string) =>
  (await getDb().select().from(catalogProducts).where(and(eq(catalogProducts.tenantId, T), eq(catalogProducts.alegraId, alegraId))))[0]
const seg = (n: number) => new Date(Date.UTC(2026, 9, 6, 10, 0, n))

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedLista(T, "Lista A", "2", { esReferencia: true })
})
afterAll(async () => {
  await truncateAll()
})

describe("sync y webhook recalculan el precio online", () => {
  it("un producto nuevo recibe su precio, sin overlay (oculto) y como 'nuevo sin revisar'", async () => {
    await upsertProductos(T, [item("1", 100)], { leidoAt: seg(1), leidoPor: "sync" })
    const p = await fila("1")
    expect(p.precioOnlineRef).toBe("200.00")
    expect(p.costoAplicado).toBe("100.0000")
    expect(await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.tenantId, T))).toHaveLength(0)
    expect(await contarAlertas(T)).toMatchObject({ nuevosSinRevisar: 1, sinCosto: 0, retenidos: 0 })
  })

  it("sin costo no hay precio (nunca 0) y queda en la alerta 'sin costo'", async () => {
    await upsertProductos(T, [item("1", undefined), item("2", 0)], { leidoAt: seg(1), leidoPor: "sync" })
    for (const id of ["1", "2"]) {
      const p = await fila(id)
      expect(p.preciosOnline).toEqual([])
      expect(p.precioOnlineRef).toBeNull()
    }
    expect((await contarAlertas(T)).sinCosto).toBe(2)
  })

  it("el webhook (leidoPor webhook) aplica dentro del umbral y retiene por encima", async () => {
    await upsertProductos(T, [item("1", 100), item("2", 100)], { leidoAt: seg(1), leidoPor: "sync" })
    await upsertProductos(T, [item("1", 105)], { leidoAt: seg(2), leidoPor: "webhook" })
    await upsertProductos(T, [item("2", 130)], { leidoAt: seg(3), leidoPor: "webhook" })
    expect((await fila("1")).precioOnlineRef).toBe("210.00")
    expect((await fila("2")).precioOnlineRef).toBe("200.00") // retenido: sigue el precio vigente
    expect((await fila("2")).costo).toBe("130.0000") // el costo nuevo SÍ queda en el espejo
    const { items } = await listarRetenidos(T, { start: 0, limit: 10 })
    expect(items).toMatchObject([{ alegraId: "2", costoVigente: "100.0000", costoPropuesto: "130.0000" }])
  })

  it("una sync repetida con el mismo costo es idempotente (no duplica retenciones)", async () => {
    await upsertProductos(T, [item("1", 100)], { leidoAt: seg(1), leidoPor: "sync" })
    await upsertProductos(T, [item("1", 300)], { leidoAt: seg(2), leidoPor: "sync" })
    await upsertProductos(T, [item("1", 300)], { leidoAt: seg(3), leidoPor: "sync" })
    expect((await listarRetenidos(T, { start: 0, limit: 10 })).total).toBe(1)
  })

  it("productos solo-secundaria usan su propio costo", async () => {
    const [cuenta] = await getDb()
      .insert(alegraCuentas)
      .values({ tenantId: T, slug: "mdp", nombre: "Cuenta MDP", principal: false })
      .returning()
    await upsertProductosSecundaria(
      T,
      cuenta.id,
      [{ producto: item("mdp:9", 50), alegraIdCuenta: "9", estado: "active" }],
      { leidoAt: seg(1), leidoPor: "sync" },
    )
    expect((await fila("mdp:9")).precioOnlineRef).toBe("100.00")
  })

  it("el par IGZ/MDP toma el costo de la fila principal (IGZ)", async () => {
    const [cuenta] = await getDb()
      .insert(alegraCuentas)
      .values({ tenantId: T, slug: "mdp", nombre: "Cuenta MDP", principal: false })
      .returning()
    await upsertProductos(T, [item("100", 100)], { leidoAt: seg(1), leidoPor: "sync" })
    await upsertProductosSecundaria(
      T,
      cuenta.id,
      [{ producto: item("mdp:9", 40, { code: "REF-100" }), alegraIdCuenta: "9", estado: "inactive" }],
      { leidoAt: seg(1), leidoPor: "sync" },
    )
    expect((await fila("100")).precioOnlineRef).toBe("200.00")
  })

  it("un fallo del recálculo no tumba la escritura del espejo", async () => {
    // Simula la migración 0064 sin aplicar en una base: la función no existe.
    await getDb().execute(
      sql`ALTER FUNCTION public.aplicar_precios_online(text, text[], text) RENAME TO aplicar_precios_online_x`,
    )
    try {
      await upsertProductos(T, [item("1", 100)], { leidoAt: seg(1), leidoPor: "sync" })
      const p = await fila("1")
      expect(p.costo).toBe("100.0000") // el espejo se escribió
      expect(p.preciosOnline).toEqual([]) // sin recálculo
    } finally {
      await getDb().execute(
        sql`ALTER FUNCTION public.aplicar_precios_online_x(text, text[], text) RENAME TO aplicar_precios_online`,
      )
    }
  })
})
