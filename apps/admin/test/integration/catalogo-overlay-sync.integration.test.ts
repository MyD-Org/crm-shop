import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogOverlay, catalogOverlayTags, catalogProducts } from "@/db/schema"
import { seedTenant, truncateAll } from "./helpers"

// EL test de regresión de este cambio: una corrida completa de la sync de Alegra NO puede
// pisar ni un byte del dato comercial editado a mano.
//
// El riesgo es concreto y está a una línea de distancia: alegra-sync hace onConflictDoUpdate
// pisando code, name, description, category_alegra_id, prices, stock, status, images y
// synced_at con excluded.*. Si alguien agregara el overlay a esa lista, o moviera un campo
// editable a catalog_products, este test tiene que fallar.

vi.mock("@/lib/alegra", () => ({
  listAllCategories: async () => categoriasDeAlegra,
  listAllItems: async () => itemsDeAlegra,
}))

const { syncCatalog } = await import("@/lib/alegra-sync")
const repo = await import("@/lib/catalogo-overlay-repo")

const TENANT = "tenant-a"
const config = { id: TENANT } as Parameters<typeof syncCatalog>[0]

let categoriasDeAlegra: unknown[] = []
let itemsDeAlegra: unknown[] = []

const item = (alegraId: string, extra: Record<string, unknown> = {}) => ({
  alegraId,
  code: null,
  name: `COD-${alegraId}`,
  description: `DESCRIPCION CRUDA ${alegraId}`,
  categoryAlegraId: "cat-alegra-1",
  prices: [{ idPriceList: "1", name: "General", price: 1500 }],
  stock: 10,
  images: [],
  ...extra,
})

const overlayDe = async (alegraId: string) => {
  const [row] = await getDb()
    .select()
    .from(catalogOverlay)
    .where(and(eq(catalogOverlay.tenantId, TENANT), eq(catalogOverlay.alegraId, alegraId)))
  return row
}

beforeEach(async () => {
  await truncateAll()
  await getDb().execute(
    sql`truncate table catalog_products, catalog_categories, catalog_sync_log, catalog_overlay, shop_categories, shop_tags restart identity cascade`,
  )
  await seedTenant(TENANT)
  categoriasDeAlegra = [{ alegraId: "cat-alegra-1", name: "Categoría de Alegra", parentAlegraId: null }]
  itemsDeAlegra = [item("1"), item("2")]
})

afterAll(async () => {
  await truncateAll()
})

describe("la sync de Alegra no pisa el overlay", () => {
  it("deja el overlay byte a byte igual, incluidos sus tags, tras dos corridas seguidas", async () => {
    await syncCatalog(config, "manual")

    const cat = await repo.crearCategoria(TENANT, { nombre: "Térmicas" })
    if (cat.kind !== "ok") throw new Error("seed")
    const tag = await repo.crearTag(TENANT, { nombre: "Oferta" })
    if (tag.kind !== "ok") throw new Error("seed")

    await repo.guardarOverlay(TENANT, "1", {
      visible: true,
      nombre: "Térmica bipolar 16A",
      descripcion: "Descripción comercial",
      categoriaId: cat.row.id,
      orden: 3,
      fotos: [{ url: "https://fotos.example/abc-800.webp", w: 800, alt: "Térmica" }],
    })
    await repo.asignarTagsProducto(TENANT, "1", [tag.row.id])

    const antes = await overlayDe("1")
    const tagsAntes = await getDb().select().from(catalogOverlayTags)

    // Alegra devuelve el ítem con su nombre crudo, sin imágenes y con otro precio/stock.
    itemsDeAlegra = [
      item("1", { name: "OTRO-COD", description: "OTRA DESCRIPCION", stock: 99, prices: [{ idPriceList: "1", price: 2500 }] }),
      item("2"),
    ]
    await syncCatalog(config, "manual")
    await syncCatalog(config, "manual")

    const despues = await overlayDe("1")
    expect(despues).toEqual(antes) // comparación campo a campo, updated_at incluido
    expect(await getDb().select().from(catalogOverlayTags)).toEqual(tagsAntes)

    // …y el espejo SÍ quedó actualizado con lo que vino de Alegra.
    const [producto] = await getDb()
      .select()
      .from(catalogProducts)
      .where(and(eq(catalogProducts.tenantId, TENANT), eq(catalogProducts.alegraId, "1")))
    expect(producto.name).toBe("OTRO-COD")
    expect(producto.stock).toBe("99")
  })

  it("una baja en Alegra marca inactivo sin borrar, y el overlay sobrevive a la vuelta", async () => {
    await syncCatalog(config, "manual")
    await repo.guardarOverlay(TENANT, "2", { visible: true, nombre: "Cable 2.5" })
    const antes = await overlayDe("2")

    // Alegra deja de listarlo.
    itemsDeAlegra = [item("1")]
    await syncCatalog(config, "manual")

    const [inactivo] = await getDb()
      .select()
      .from(catalogProducts)
      .where(and(eq(catalogProducts.tenantId, TENANT), eq(catalogProducts.alegraId, "2")))
    expect(inactivo.status).toBe("inactive") // soft, no borrado
    expect(await overlayDe("2")).toEqual(antes) // el overlay intacto

    // Vuelve a listarlo: reaparece con su nombre y su visibilidad previos, sin intervención.
    itemsDeAlegra = [item("1"), item("2")]
    await syncCatalog(config, "manual")

    const [reactivado] = await getDb()
      .select()
      .from(catalogProducts)
      .where(and(eq(catalogProducts.tenantId, TENANT), eq(catalogProducts.alegraId, "2")))
    expect(reactivado.status).toBe("active")
    expect(await overlayDe("2")).toEqual(antes)
  })

  it("un overlay sin producto espejado no rompe el listado del admin", async () => {
    // Fila de overlay para un alegra_id que no existe en el espejo (el overlay puede preceder).
    await repo.guardarOverlay(TENANT, "huerfano", { visible: true, nombre: "Todavía no espejado" })
    await syncCatalog(config, "manual")

    // El listado sale de catalog_products, así que el huérfano simplemente no aparece — y, lo
    // que importa, no hace fallar la consulta.
    await expect(repo.contarSeleccion(TENANT, { tipo: "filtro", filtros: {} })).resolves.toBe(2)
    expect(await overlayDe("huerfano")).toBeTruthy()
  })
})
