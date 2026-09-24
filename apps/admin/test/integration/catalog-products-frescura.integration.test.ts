import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import type { AlegraProduct } from "@/lib/alegra"
import { seedTenant, truncateAll } from "./helpers"

// Frescura por fila del espejo de productos (change `webhooks-stock-alegra`, D5): el dato
// leído más tarde de Alegra gana, llegue por la sync diaria o por un aviso. Contra Postgres
// real (crm_test); Alegra mockeado. Datos inventados.

vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  listAllCategories: async () => [],
  listAllItems: async () => itemsDeAlegra,
}))

const { syncCatalog } = await import("@/lib/alegra-sync")
const { upsertProductos, marcarItemInactivo } = await import("@/lib/catalog-products-repo")

const TENANT = "tenant-a"
const config = { id: TENANT } as Parameters<typeof syncCatalog>[0]

let itemsDeAlegra: AlegraProduct[] = []

const item = (alegraId: string, stock: number, extra: Partial<AlegraProduct> = {}): AlegraProduct => ({
  alegraId,
  code: `REF-${alegraId}`,
  name: `Producto ${alegraId}`,
  description: null,
  categoryAlegraId: null,
  prices: [{ idPriceList: "1", name: "General", price: 1000 }],
  stock,
  status: "active",
  images: [],
  brand: null,
  ivaPorcentaje: 21,
  raw: { id: alegraId },
  ...extra,
})

async function fila(alegraId: string) {
  const [row] = await getDb()
    .select()
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, TENANT), eq(catalogProducts.alegraId, alegraId)))
  return row
}

const seg = (n: number) => new Date(Date.UTC(2026, 8, 24, 10, 0, n))

beforeEach(async () => {
  await truncateAll()
  await seedTenant(TENANT)
  itemsDeAlegra = []
})

afterAll(async () => {
  await truncateAll()
})

describe("upsertProductos por frescura", () => {
  it("la sync (T0) no pisa lo que un webhook leyó después (T1 > T0)", async () => {
    const enUnMinuto = new Date(Date.now() + 60_000)
    await upsertProductos(TENANT, [item("5", 8)], { leidoAt: enUnMinuto, leidoPor: "webhook" })

    itemsDeAlegra = [item("5", 10)]
    const r = await syncCatalog(config, "manual")
    expect(r.ok).toBe(true)

    const f = await fila("5")
    expect(f.stock).toBe("8")
    expect(f.leidoPor).toBe("webhook")
    expect(f.alegraLeidoAt?.getTime()).toBe(enUnMinuto.getTime())
    expect(f.status).toBe("active")
  })

  it("un webhook viejo (T < T0) no pisa la sync", async () => {
    await upsertProductos(TENANT, [item("5", 10)], { leidoAt: seg(30), leidoPor: "sync" })
    await upsertProductos(TENANT, [item("5", 8)], { leidoAt: seg(10), leidoPor: "webhook" })
    const f = await fila("5")
    expect(f.stock).toBe("10")
    expect(f.leidoPor).toBe("sync")
  })

  it("una lectura más nueva sí pisa, y todas las columnas de Alegra juntas", async () => {
    await upsertProductos(TENANT, [item("5", 10)], { leidoAt: seg(10), leidoPor: "sync" })
    await upsertProductos(TENANT, [item("5", 8, { name: "Nombre nuevo", status: "inactive" })], { leidoAt: seg(20), leidoPor: "webhook" })
    const f = await fila("5")
    expect(f.stock).toBe("8")
    expect(f.name).toBe("Nombre nuevo")
    expect(f.alegraStatus).toBe("inactive")
    expect(f.leidoPor).toBe("webhook")
  })

  it("synced_at se actualiza siempre y la sync sigue marcando inactive lo no visto", async () => {
    const enUnMinuto = new Date(Date.now() + 60_000)
    await upsertProductos(TENANT, [item("5", 8), item("6", 3)], { leidoAt: enUnMinuto, leidoPor: "webhook" })
    await getDb().execute(sql`UPDATE catalog_products SET synced_at = now() - interval '1 day' WHERE tenant_id = ${TENANT}`)
    const antes = (await fila("5")).syncedAt

    itemsDeAlegra = [item("5", 10)] // el 6 ya no aparece en Alegra
    await syncCatalog(config, "manual")

    const f5 = await fila("5")
    expect(f5.syncedAt.getTime()).toBeGreaterThan(antes.getTime())
    expect(f5.status).toBe("active") // visto: no lo marca stale aunque conservó el dato del webhook
    expect(f5.stock).toBe("8")
    expect((await fila("6")).status).toBe("inactive")
  })

  it("NULL en alegra_leido_at cuenta como −∞ (filas anteriores a la migración)", async () => {
    await upsertProductos(TENANT, [item("5", 10)], { leidoAt: seg(10), leidoPor: "sync" })
    await getDb().execute(sql`UPDATE catalog_products SET alegra_leido_at = NULL, leido_por = NULL WHERE tenant_id = ${TENANT}`)
    await upsertProductos(TENANT, [item("5", 7)], { leidoAt: seg(0), leidoPor: "webhook" })
    const f = await fila("5")
    expect(f.stock).toBe("7")
    expect(f.leidoPor).toBe("webhook")
  })

  it("el mismo valor dos veces es idempotente", async () => {
    await upsertProductos(TENANT, [item("5", 8)], { leidoAt: seg(10), leidoPor: "webhook" })
    await upsertProductos(TENANT, [item("5", 8)], { leidoAt: seg(10), leidoPor: "webhook" })
    const rows = await getDb().select().from(catalogProducts).where(eq(catalogProducts.tenantId, TENANT))
    expect(rows).toHaveLength(1)
    expect(rows[0].stock).toBe("8")
  })

  it("un alegra_id repetido en la misma tanda no rompe: queda el último", async () => {
    await upsertProductos(TENANT, [item("5", 8), item("5", 9)], { leidoAt: seg(10), leidoPor: "sync" })
    expect((await fila("5")).stock).toBe("9")
  })
})

describe("marcarItemInactivo", () => {
  it("marca inactive con la hora de la lectura", async () => {
    await upsertProductos(TENANT, [item("5", 8)], { leidoAt: seg(10), leidoPor: "sync" })
    expect(await marcarItemInactivo(TENANT, "5", seg(20))).toBe(true)
    const f = await fila("5")
    expect(f.status).toBe("inactive")
    expect(f.leidoPor).toBe("webhook")
    expect(f.alegraLeidoAt?.getTime()).toBe(seg(20).getTime())
  })

  it("no pisa una lectura más nueva", async () => {
    await upsertProductos(TENANT, [item("5", 8)], { leidoAt: seg(30), leidoPor: "sync" })
    expect(await marcarItemInactivo(TENANT, "5", seg(20))).toBe(false)
    expect((await fila("5")).status).toBe("active")
  })

  it("un ítem que no está en el espejo: no hace nada", async () => {
    expect(await marcarItemInactivo(TENANT, "999", seg(20))).toBe(false)
  })
})
