import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraCategory, AlegraProduct } from "@/lib/alegra"
import { seedTenant, truncateAll } from "./helpers"

// Guarda de la sync del catálogo (change `catalogo-shop-desde-crm`, PR-1b / D7), contra Postgres
// real (crm_test) con Alegra mockeado: una corrida sensiblemente más corta que la última OK del
// tenant upsertea lo leído pero no da de baja nada ni empuja el overlay, y queda 'parcial'.
// Datos inventados: tenant-a / tenant-b, ítems de fantasía.

vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  listAllCategories: async () => categoriasDeAlegra,
  listAllItems: async () => itemsDeAlegra,
}))

const { syncCatalog } = await import("@/lib/alegra-sync")

const A = "tenant-a"
const B = "tenant-b"
const cfg = (id: string) => ({ id }) as Parameters<typeof syncCatalog>[0]

let categoriasDeAlegra: AlegraCategory[] = []
let itemsDeAlegra: AlegraProduct[] = []

const VIEJO = "2026-01-01T00:00:00Z"
const OVERLAY_VIEJO = new Date(VIEJO).toISOString()

const item = (alegraId: string, precio = 1000): AlegraProduct => ({
  alegraId,
  code: `REF-${alegraId}`,
  name: `Producto ${alegraId}`,
  description: null,
  categoryAlegraId: null,
  prices: [{ idPriceList: "1", name: "General", price: precio }],
  stock: 1,
  status: "active",
  images: [],
  brand: null,
  ivaPorcentaje: 21,
  raw: { id: alegraId },
})
const items = (n: number) => Array.from({ length: n }, (_, i) => item(String(i + 1)))
const categorias = (n: number): AlegraCategory[] =>
  Array.from({ length: n }, (_, i) => ({ alegraId: `c${i + 1}`, name: `Categoría ${i + 1}`, parentAlegraId: null, status: "active" }))

async function seedLog(tenant: string, status: string, itemsSynced: number, categoriesSynced: number, startedAt: string) {
  await getDb().execute(sql`
    INSERT INTO catalog_sync_log (tenant_id, trigger, status, items_synced, categories_synced, started_at, finished_at)
    VALUES (${tenant}, 'cron', ${status}, ${itemsSynced}, ${categoriesSynced}, ${startedAt}, ${startedAt})
  `)
}

/** Filas del espejo vistas por última vez hace mucho, cada una con su overlay visible. */
async function seedEspejo(tenant: string, n: number, cats = 3) {
  await getDb().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, name, prices, status, synced_at)
    SELECT ${tenant}, g::text, 'Producto ' || g, '[{"price":1000}]'::jsonb, 'active', ${VIEJO}
    FROM generate_series(1, ${n}) g
  `)
  await getDb().execute(sql`
    INSERT INTO catalog_overlay (tenant_id, alegra_id, visible, updated_at)
    SELECT ${tenant}, g::text, true, ${VIEJO} FROM generate_series(1, ${n}) g
  `)
  await getDb().execute(sql`
    INSERT INTO catalog_categories (tenant_id, alegra_id, name, status, synced_at)
    SELECT ${tenant}, 'c' || g, 'Categoría ' || g, 'active', ${VIEJO} FROM generate_series(1, ${cats}) g
  `)
}

async function contar(consulta: ReturnType<typeof sql>): Promise<number> {
  const r = await getDb().execute<{ n: number }>(consulta)
  return Number(r[0]?.n ?? 0)
}
const inactivos = (tenant: string) =>
  contar(sql`SELECT count(*) AS n FROM catalog_products WHERE tenant_id = ${tenant} AND status = 'inactive'`)
const categoriasInactivas = (tenant: string) =>
  contar(sql`SELECT count(*) AS n FROM catalog_categories WHERE tenant_id = ${tenant} AND status = 'inactive'`)
const overlaysMovidos = (tenant: string) =>
  contar(sql`SELECT count(*) AS n FROM catalog_overlay WHERE tenant_id = ${tenant} AND updated_at <> ${OVERLAY_VIEJO}::timestamptz`)
async function ultimoLog(tenant: string) {
  const r = await getDb().execute<{ status: string; items_synced: number; categories_synced: number; error: string | null }>(sql`
    SELECT status, items_synced, categories_synced, error FROM catalog_sync_log
    WHERE tenant_id = ${tenant} ORDER BY started_at DESC LIMIT 1
  `)
  return r[0]
}

beforeEach(async () => {
  await truncateAll()
  await getDb().execute(
    sql`truncate table catalog_products, catalog_categories, catalog_sync_log, catalog_overlay restart identity cascade`,
  )
  await seedTenant(A)
  await seedTenant(B)
  categoriasDeAlegra = categorias(3)
  itemsDeAlegra = []
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})

afterAll(async () => {
  vi.restoreAllMocks()
  await truncateAll()
})

describe("guarda de la sync: corrida truncada", () => {
  beforeEach(async () => {
    await seedLog(A, "ok", 100, 3, "2026-09-20T07:00:00Z")
    await seedEspejo(A, 100)
    // Lee 50 de 100; el 50 vino con precio 0 (en una corrida normal, su overlay se empujaría).
    itemsDeAlegra = [...items(49), item("50", 0)]
  })

  it("50 de 100 → parcial: upsertea lo leído, 0 inactive, overlay intacto", async () => {
    const r = await syncCatalog(cfg(A), "cron")
    expect(r).toMatchObject({ ok: true, parcial: true, itemsSynced: 50, categoriesSynced: 3 })
    expect(r.motivo).toBe("items 50 < base 100 (umbral 95 %)")

    expect(await inactivos(A)).toBe(0)
    expect(await overlaysMovidos(A)).toBe(0)
    expect(
      await contar(sql`SELECT count(*) AS n FROM catalog_products WHERE tenant_id = ${A} AND synced_at > ${VIEJO}::timestamptz`),
    ).toBe(50)
    expect(await ultimoLog(A)).toMatchObject({
      status: "parcial",
      items_synced: 50,
      categories_synced: 3,
      error: "items 50 < base 100 (umbral 95 %)",
    })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`[alegra-sync] tenant=${A} corrida=parcial items=50 base=100`))
  })

  it("la misma corrida con aceptarBaja → 50 inactive, overlay empujado, log ok", async () => {
    const r = await syncCatalog(cfg(A), "cron", { aceptarBaja: true })
    expect(r).toEqual({ ok: true, itemsSynced: 50, categoriesSynced: 3 })
    expect(await inactivos(A)).toBe(50)
    expect(await overlaysMovidos(A)).toBe(1) // el de precio 0
    expect((await ultimoLog(A)).status).toBe("ok")
  })
})

it("0 ítems sin historial → parcial, nada inactive", async () => {
  await seedEspejo(A, 5)
  const r = await syncCatalog(cfg(A), "manual")
  expect(r).toMatchObject({ ok: true, parcial: true, itemsSynced: 0 })
  expect(await inactivos(A)).toBe(0)
  expect((await ultimoLog(A)).status).toBe("parcial")
})

it("la base ignora las 'parcial' previas: ok 1000, parcial 400, luego 950 → ok", async () => {
  await seedLog(A, "ok", 1000, 3, "2026-09-20T07:00:00Z")
  await seedLog(A, "parcial", 400, 3, "2026-09-21T07:00:00Z")
  await seedLog(A, "error", 0, 0, "2026-09-22T07:00:00Z")
  itemsDeAlegra = items(950)
  const r = await syncCatalog(cfg(A), "cron")
  expect(r.parcial).toBeUndefined()
  expect((await ultimoLog(A)).status).toBe("ok")
})

it("la base es por tenant: tenant-a 1000, tenant-b 100; tenant-b lee 95 → ok", async () => {
  await seedLog(A, "ok", 1000, 3, "2026-09-20T07:00:00Z")
  await seedLog(B, "ok", 100, 3, "2026-09-20T07:00:00Z")
  itemsDeAlegra = items(95)
  const r = await syncCatalog(cfg(B), "cron")
  expect(r.parcial).toBeUndefined()
  expect((await ultimoLog(B)).status).toBe("ok")
})

it("categorías 0 con ítems normales → stale de productos sí, de categorías no", async () => {
  await seedLog(A, "ok", 100, 3, "2026-09-20T07:00:00Z")
  await seedEspejo(A, 101) // el 101 ya no viene de Alegra
  categoriasDeAlegra = []
  itemsDeAlegra = items(100)
  const r = await syncCatalog(cfg(A), "cron")
  expect(r).toMatchObject({ ok: true, parcial: true, motivo: "categorias 0 < base 3 (umbral 95 %)" })
  expect(await inactivos(A)).toBe(1)
  expect(await categoriasInactivas(A)).toBe(0)
  expect((await ultimoLog(A)).status).toBe("parcial")
})
