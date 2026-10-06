import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, catalogProducts } from "@/db/schema"
import type { AlegraProduct } from "@/lib/alegra"
import { costoDeItem } from "@/lib/alegra"
import { upsertProductos, upsertProductosSecundaria } from "@/lib/catalog-products-repo"
import { seedTenant, truncateAll } from "./helpers"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

// Costo en el espejo (change `listas-precio-online`, rebanada A, migración 0063): la sync y el
// webhook escriben `costo` desde inventory.unitCost con la misma frescura por fila que el resto;
// la fila principal de un par IGZ/MDP conserva el costo de IGZ; el backfill es idempotente.
// Contra Postgres real (crm_test). Datos inventados.

const TENANT = "tenant-costo"
const MIGRACION = fileURLToPath(new URL("../../drizzle/0063_costo_espejo.sql", import.meta.url))

/** Un ítem como lo devuelve el mapper de Alegra (costo derivado de raw con costoDeItem). */
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

async function fila(alegraId: string) {
  const [row] = await getDb()
    .select()
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, TENANT), eq(catalogProducts.alegraId, alegraId)))
  return row
}

const seg = (n: number) => new Date(Date.UTC(2026, 9, 6, 10, 0, n))

beforeEach(async () => {
  await truncateAll()
  await seedTenant(TENANT)
})

afterAll(async () => {
  await truncateAll()
})

describe("costo en el espejo: upsert", () => {
  it("la sync escribe costo desde inventory.unitCost", async () => {
    await upsertProductos(TENANT, [item("1", 100), item("2", "250.5")], { leidoAt: seg(0), leidoPor: "sync" })
    expect(Number((await fila("1")).costo)).toBe(100)
    expect(Number((await fila("2")).costo)).toBe(250.5)
  })

  it("costo ausente, 0 o inválido => null (nunca 0)", async () => {
    await upsertProductos(TENANT, [item("1", undefined), item("2", 0), item("3", "abc"), item("4", -3)], {
      leidoAt: seg(0),
      leidoPor: "sync",
    })
    for (const id of ["1", "2", "3", "4"]) expect((await fila(id)).costo).toBeNull()
  })

  it("no toca costo_aplicado (lo gobierna la rebanada B)", async () => {
    await upsertProductos(TENANT, [item("1", 100)], { leidoAt: seg(0), leidoPor: "sync" })
    expect((await fila("1")).costoAplicado).toBeNull()
    await getDb()
      .update(catalogProducts)
      .set({ costoAplicado: "100" })
      .where(and(eq(catalogProducts.tenantId, TENANT), eq(catalogProducts.alegraId, "1")))
    await upsertProductos(TENANT, [item("1", 150)], { leidoAt: seg(1), leidoPor: "webhook" })
    const f = await fila("1")
    expect(Number(f.costo)).toBe(150)
    expect(Number(f.costoAplicado)).toBe(100)
  })

  it("frescura por fila: una lectura más nueva pisa; una más vieja no", async () => {
    await upsertProductos(TENANT, [item("1", 100)], { leidoAt: seg(10), leidoPor: "webhook" })
    // La sync leyó la página antes que el webhook: no pisa.
    await upsertProductos(TENANT, [item("1", 90)], { leidoAt: seg(5), leidoPor: "sync" })
    expect(Number((await fila("1")).costo)).toBe(100)
    // Una lectura posterior sí pisa.
    await upsertProductos(TENANT, [item("1", 120)], { leidoAt: seg(20), leidoPor: "webhook" })
    expect(Number((await fila("1")).costo)).toBe(120)
  })

  it("una lectura nueva sin costo lo deja en null (el costo desapareció en Alegra)", async () => {
    await upsertProductos(TENANT, [item("1", 100)], { leidoAt: seg(0), leidoPor: "sync" })
    await upsertProductos(TENANT, [item("1", 0)], { leidoAt: seg(5), leidoPor: "sync" })
    expect((await fila("1")).costo).toBeNull()
  })
})

describe("costo en el espejo: par IGZ/MDP (DC4)", () => {
  async function cuentaMdp() {
    const [c] = await getDb()
      .insert(alegraCuentas)
      .values({ tenantId: TENANT, slug: "mdp", nombre: "MDP", alegraMock: true })
      .returning({ id: alegraCuentas.id })
    return c.id
  }

  it("la fila principal conserva el costo de IGZ; la solo-MDP usa el suyo", async () => {
    // La sync de la cuenta secundaria solo escribe filas solo-secundaria (alegra_id sintético
    // `mdp:<id>`): nunca toca la fila principal, así que el costo de IGZ queda como está.
    const cuentaId = await cuentaMdp()
    await upsertProductos(TENANT, [item("1", 100)], { leidoAt: seg(0), leidoPor: "sync" })
    await upsertProductosSecundaria(
      TENANT,
      cuentaId,
      [
        { producto: item("mdp:7", 55), alegraIdCuenta: "7", estado: "active" },
        // El mismo producto que en IGZ, con costo distinto en MDP: no existe fila `mdp:1` (el pareo la
        // absorbe en la principal), pero aunque se escribiera, la principal no se toca.
        { producto: item("mdp:1", 999), alegraIdCuenta: "1", estado: "inactive" },
      ],
      { leidoAt: seg(1), leidoPor: "sync" },
    )
    expect(Number((await fila("1")).costo)).toBe(100)
    expect(Number((await fila("mdp:7")).costo)).toBe(55)
  })
})

describe("migración 0063: backfill desde raw", () => {
  /** El backfill tal cual está en la migración (los UPDATE posteriores al ALTER). */
  function sentenciasDeBackfill(): string[] {
    return readFileSync(MIGRACION, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => /^UPDATE/m.test(s.replace(/^--.*$/gm, "").trim()))
      .map((s) => s.replace(/^--.*$/gm, "").trim())
  }

  it("completa costo y costo_aplicado donde raw trae unitCost > 0; el resto queda null; idempotente", async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    try {
      const filas: [string, string][] = [
        ["a", '{"inventory":{"unitCost":100}}'],
        ["b", '{"inventory":{"unitCost":"33.3333"}}'],
        ["c", '{"inventory":{"unitCost":0}}'],
        ["d", '{"inventory":{"unitCost":null}}'],
        ["e", '{"inventory":{}}'],
        ["f", "{}"],
        ["g", '{"inventory":"x"}'],
        ["h", '{"inventory":{"unitCost":"abc"}}'],
        ["i", '{"inventory":{"unitCost":-4}}'],
        ["j", '{"inventory":{"unitCost":99999999999999}}'],
      ]
      for (const [id, raw] of filas) {
        await sql`INSERT INTO catalog_products (tenant_id, alegra_id, name, raw) VALUES (${TENANT}, ${id}, ${"P" + id}, ${raw}::text::jsonb)`
      }
      await sql`INSERT INTO catalog_products (tenant_id, alegra_id, name, raw) VALUES (${TENANT}, 'k', 'Pk', NULL)`

      const leer = async () =>
        (await sql`SELECT alegra_id, costo, costo_aplicado FROM catalog_products WHERE tenant_id = ${TENANT} ORDER BY alegra_id`).map(
          (r) => [r.alegra_id, r.costo === null ? null : Number(r.costo), r.costo_aplicado === null ? null : Number(r.costo_aplicado)],
        )

      const stmts = sentenciasDeBackfill()
      expect(stmts).toHaveLength(2)
      for (const s of stmts) await sql.unsafe(s)
      const primera = await leer()
      expect(primera).toEqual([
        ["a", 100, 100],
        ["b", 33.3333, 33.3333],
        ["c", null, null],
        ["d", null, null],
        ["e", null, null],
        ["f", null, null],
        ["g", null, null],
        ["h", null, null],
        ["i", null, null],
        ["j", null, null],
        ["k", null, null],
      ])

      // Idempotente: una segunda corrida no cambia nada, ni pisa un costo ya actualizado.
      await sql`UPDATE catalog_products SET costo = 120 WHERE tenant_id = ${TENANT} AND alegra_id = 'a'`
      for (const s of stmts) await sql.unsafe(s)
      const segunda = await leer()
      expect(segunda.find((r) => r[0] === "a")).toEqual(["a", 120, 100])
      expect(segunda.filter((r) => r[0] !== "a")).toEqual(primera.filter((r) => r[0] !== "a"))
    } finally {
      await sql.end()
    }
  })
})
