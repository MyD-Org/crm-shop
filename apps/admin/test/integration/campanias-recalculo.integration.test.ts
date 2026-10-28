import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts, catalogVariantesManuales } from "@/db/schema"
import { guardarOverlay, masivaOverlay } from "@/lib/catalogo-overlay-repo"
import { recalcularGrupos } from "@/lib/catalogo-variantes-repo"
import { seedTenant, truncateAll } from "./helpers"
import { aplicar, seedCampania, seedCategoria, seedLista, seedProducto, seedRegla } from "./precios-online-helpers"

// Una campaña por categoría se recalcula en el momento cuando cambia la categoría de un producto
// o su grupo de variantes (spec 2026-10-28-campanias-precios-design.md), sin esperar a la sync.
// Datos inventados.

const T = "tenant-camp-rec"
let cat: string

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedLista(T, "Tarjeta cuotas", "1.6", { esReferencia: true })
  cat = await seedCategoria(T, "lamparas")
  for (const id of ["A", "M", "V"]) await seedProducto(T, { alegraId: id, costo: "100" })
  await aplicar(T, null, "config")
  const [{ n }] = (await getDb().execute(sql`SELECT now() AS n`)) as unknown as { n: string }[]
  const ahora = new Date(n)
  const c = await seedCampania(T, { inicio: new Date(ahora.getTime() - 3_600_000), fin: new Date(ahora.getTime() + 86_400_000) })
  await seedRegla(T, c, { tipo: "categoria", categoriaId: cat, pct: 20 })
})
afterAll(async () => {
  await truncateAll()
})

async function entradas(alegraId: string): Promise<unknown[] | null> {
  const [p] = await getDb()
    .select({ c: catalogProducts.campaniasOnline })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, T), eq(catalogProducts.alegraId, alegraId)))
  return p.c as unknown[] | null
}

describe("recálculo de campañas al editar el catálogo", () => {
  it("asignar la categoría en la ficha crea la entrada; quitarla la borra", async () => {
    expect(await entradas("A")).toBeNull()
    await guardarOverlay(T, "A", { categoriaId: cat })
    expect(await entradas("A")).toHaveLength(1)
    await guardarOverlay(T, "A", { categoriaId: null })
    expect(await entradas("A")).toBeNull()
  })

  it("asignar la categoría en masa crea las entradas", async () => {
    const r = await masivaOverlay(T, { tipo: "ids", alegraIds: ["A", "V"] }, { tipo: "categoria", categoriaId: cat })
    expect(r.kind).toBe("ok")
    expect(await entradas("A")).toHaveLength(1)
    expect(await entradas("V")).toHaveLength(1)
  })

  it("sumar un producto a un grupo cuya ancla está en la categoría le crea la entrada", async () => {
    await guardarOverlay(T, "M", { categoriaId: cat })
    expect(await entradas("V")).toBeNull()
    await getDb().insert(catalogVariantesManuales).values([
      { tenantId: T, alegraId: "M", grupoId: "M", etiqueta: "Base" },
      { tenantId: T, alegraId: "V", grupoId: "M", etiqueta: "Variante" },
    ])
    await recalcularGrupos(T, { alegraIds: ["M", "V"] })
    expect(await entradas("V")).toHaveLength(1)
  })
})
