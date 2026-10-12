import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraProduct } from "@/lib/alegra"
import { seedTenant, truncateAll } from "./helpers"

// La sync diaria del catálogo escribe tipo / padre / opción y, al cerrar la pasada, calcula grupos y
// representantes de todo el tenant (change `variantes-de-producto`, S2). Alegra mockeado, Postgres
// real (crm_test). Datos inventados.

vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  listAllCategories: async () => [],
  listItemsLote: async (_c: unknown, start: number) => ({ items: itemsDeAlegra.slice(start), siguiente: itemsDeAlegra.length, fin: true }),
}))

// Este tenant de prueba no tiene listas de precio online: el recálculo las dejaría vacías y pisaría
// los precios sembrados a mano. Se anula; lo que se prueba acá son las variantes, no los precios.
vi.mock("@/lib/precios-online-costos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/precios-online-costos")>()),
  recalcularTrasSync: async () => {},
}))

const { syncCatalog } = await import("@/lib/alegra-sync")

const TENANT = "tenant-sv"
const config = { id: TENANT } as Parameters<typeof syncCatalog>[0]

let itemsDeAlegra: AlegraProduct[] = []

const item = (alegraId: string, extra: Partial<AlegraProduct> = {}): AlegraProduct => ({
  alegraId,
  code: null, // Avantec no usa códigos
  name: `Producto ${alegraId}`,
  description: null,
  categoryAlegraId: null,
  prices: [{ idPriceList: "1", name: "General", price: 1000 }],
  stock: 5,
  status: "active",
  images: [],
  brand: null,
  ivaPorcentaje: 21,
  raw: { id: alegraId },
  ...extra,
})

const variante = (id: string, padre: string, opcion: string, extra: Partial<AlegraProduct> = {}) =>
  item(id, {
    name: `Modelo / ${opcion}`,
    tipo: "variante",
    padreAlegraId: padre,
    variante: [{ atributo: "Color", opcion }],
    varianteClave: opcion.toLowerCase(),
    ...extra,
  })

const leer = async () =>
  (await getDb().execute(
    sql`SELECT alegra_id, tipo, grupo_id, etiqueta, es_representante FROM catalog_products WHERE tenant_id = ${TENANT} ORDER BY alegra_id`,
  )) as unknown as { alegra_id: string; tipo: string; grupo_id: string | null; etiqueta: string | null; es_representante: boolean }[]

beforeEach(async () => {
  await truncateAll()
  await seedTenant(TENANT)
  itemsDeAlegra = []
})

afterAll(async () => {
  await truncateAll()
})

describe("sync del catálogo con variantes", () => {
  it("un modelo con variantes: el padre queda 'padre', las variantes agrupadas y una sola es representante", async () => {
    itemsDeAlegra = [
      item("P", { name: "Modelo", tipo: "padre", stock: null, prices: [] }),
      variante("v1", "P", "Verde", { stock: 0 }),
      variante("v2", "P", "Rojo", { stock: 4 }),
      item("s1"),
    ]
    const r = await syncCatalog(config, "manual")
    expect(r.ok).toBe(true)
    // Los precios online no existen en este tenant de prueba: se materializan a mano para el criterio.
    await getDb().execute(sql`UPDATE catalog_products SET precios_online = '[{"idPriceList":"l","name":"Online","price":10,"main":true}]'::jsonb WHERE tenant_id = ${TENANT}`)
    await syncCatalog(config, "manual")

    const filas = await leer()
    const por = (id: string) => filas.find((f) => f.alegra_id === id)!
    expect(por("P")).toMatchObject({ tipo: "padre", grupo_id: null, es_representante: false })
    expect(por("v1")).toMatchObject({ tipo: "variante", grupo_id: "P", etiqueta: "Verde", es_representante: false })
    expect(por("v2")).toMatchObject({ tipo: "variante", grupo_id: "P", etiqueta: "Rojo", es_representante: true })
    expect(por("s1")).toMatchObject({ tipo: "simple", grupo_id: null, es_representante: true })
  })

  it("si la variante deja de venir en Alegra, queda inactiva y el representante pasa a otra", async () => {
    itemsDeAlegra = [
      item("P", { tipo: "padre", stock: null }),
      variante("v1", "P", "Verde", { prices: [{ idPriceList: "1", name: "General", price: 900 }] }),
      variante("v2", "P", "Rojo"),
    ]
    await syncCatalog(config, "manual")
    await getDb().execute(sql`UPDATE catalog_products SET precios_online = '[{"idPriceList":"l","name":"Online","price":10,"main":true}]'::jsonb WHERE tenant_id = ${TENANT}`)
    await syncCatalog(config, "manual")
    expect((await leer()).filter((f) => f.es_representante && f.tipo === "variante").map((f) => f.alegra_id)).toEqual(["v1"])

    itemsDeAlegra = [item("P", { tipo: "padre", stock: null }), variante("v2", "P", "Rojo")]
    await syncCatalog(config, "manual", { aceptarBaja: true })
    expect((await leer()).filter((f) => f.es_representante && f.tipo === "variante").map((f) => f.alegra_id)).toEqual(["v2"])
  })
})
