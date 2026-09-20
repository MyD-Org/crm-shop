import { describe, it, expect, beforeEach } from "vitest"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogCategories, catalogOverlay, catalogProducts, shopCategories } from "@/db/schema"
import { guardarOverlay, importarCategoriasDeAlegra, listarCategoriasConUso } from "@/lib/catalogo-overlay-repo"
import { seedTenant, truncateAll } from "./helpers"

// La importación existe porque clasificar miles de productos a mano es el costo real del cambio:
// si Alegra ya sabe la categoría de una parte del catálogo, conviene partir de ahí.
// Lo que se prueba acá es que sea segura de correr más de una vez y que NUNCA pise trabajo manual.

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"

async function seedCategoriaAlegra(tenantId: string, alegraId: string, name: string, status = "active") {
  await getDb().insert(catalogCategories).values({ tenantId, alegraId, name, status })
}

async function seedProducto(tenantId: string, alegraId: string, categoryAlegraId: string | null) {
  await getDb()
    .insert(catalogProducts)
    .values({ tenantId, alegraId, name: `P${alegraId}`, categoryAlegraId, status: "active" })
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(TENANT_A)
  await seedTenant(TENANT_B)
})

describe("importarCategoriasDeAlegra", () => {
  it("crea una categoría propia por cada una de Alegra y clasifica sus productos", async () => {
    await seedCategoriaAlegra(TENANT_A, "5", "ELECTRICIDAD")
    await seedCategoriaAlegra(TENANT_A, "6", "ILUMINACION")
    await seedProducto(TENANT_A, "1", "5")
    await seedProducto(TENANT_A, "2", "5")
    await seedProducto(TENANT_A, "3", null)

    const r = await importarCategoriasDeAlegra(TENANT_A, "admin")

    expect(r).toEqual({ creadas: 2, existentes: 0, clasificados: 2 })

    const arbol = await listarCategoriasConUso(TENANT_A)
    expect(arbol.map((c) => c.nombre).sort()).toEqual(["ELECTRICIDAD", "ILUMINACION"])
    // Todas entran como nivel 1: la jerarquía de Alegra no se replica, se subdivide después.
    expect(arbol.every((c) => c.nivel === 1 && c.parentId === null)).toBe(true)
    expect(arbol.find((c) => c.nombre === "ELECTRICIDAD")?.productos).toBe(2)
  })

  it("es idempotente: correrla dos veces no duplica ni reclasifica", async () => {
    await seedCategoriaAlegra(TENANT_A, "5", "ELECTRICIDAD")
    await seedProducto(TENANT_A, "1", "5")

    await importarCategoriasDeAlegra(TENANT_A, "admin")
    const segunda = await importarCategoriasDeAlegra(TENANT_A, "admin")

    expect(segunda).toEqual({ creadas: 0, existentes: 1, clasificados: 0 })
    expect(await listarCategoriasConUso(TENANT_A)).toHaveLength(1)
  })

  it("NUNCA pisa una clasificación hecha a mano", async () => {
    await seedCategoriaAlegra(TENANT_A, "5", "ELECTRICIDAD")
    await seedProducto(TENANT_A, "1", "5")
    await seedProducto(TENANT_A, "2", "5")

    // El producto 1 ya fue clasificado a mano en otra categoría propia.
    const db = getDb()
    const [aMano] = await db
      .insert(shopCategories)
      .values({ tenantId: TENANT_A, nombre: "Cables finos", slug: "cables-finos", nivel: 1 })
      .returning({ id: shopCategories.id })
    await guardarOverlay(TENANT_A, "1", { categoriaId: aMano.id }, "admin")

    const r = await importarCategoriasDeAlegra(TENANT_A, "admin")

    // Sólo el 2 se clasifica: el trabajo manual gana sobre lo que dice Alegra.
    expect(r.clasificados).toBe(1)
    const [uno] = await db
      .select({ categoriaId: catalogOverlay.categoriaId })
      .from(catalogOverlay)
      .where(and(eq(catalogOverlay.tenantId, TENANT_A), eq(catalogOverlay.alegraId, "1")))
    expect(uno.categoriaId).toBe(aMano.id)
  })

  it("clasificar no publica: visible sigue en false", async () => {
    await seedCategoriaAlegra(TENANT_A, "5", "ELECTRICIDAD")
    await seedProducto(TENANT_A, "1", "5")

    await importarCategoriasDeAlegra(TENANT_A, "admin")

    const [fila] = await getDb()
      .select({ visible: catalogOverlay.visible })
      .from(catalogOverlay)
      .where(and(eq(catalogOverlay.tenantId, TENANT_A), eq(catalogOverlay.alegraId, "1")))
    expect(fila.visible).toBe(false)
  })

  it("ignora las categorías dadas de baja en Alegra", async () => {
    await seedCategoriaAlegra(TENANT_A, "9", "VIEJA", "inactive")

    expect(await importarCategoriasDeAlegra(TENANT_A, "admin")).toMatchObject({ creadas: 0 })
  })

  it("no cruza tenants", async () => {
    await seedCategoriaAlegra(TENANT_B, "5", "ELECTRICIDAD")
    await seedProducto(TENANT_B, "1", "5")

    expect(await importarCategoriasDeAlegra(TENANT_A, "admin")).toMatchObject({ creadas: 0, clasificados: 0 })
    expect(await listarCategoriasConUso(TENANT_A)).toHaveLength(0)
  })
})
