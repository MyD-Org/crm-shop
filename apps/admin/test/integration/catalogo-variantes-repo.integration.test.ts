import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraProduct } from "@/lib/alegra"
import { recalcularGrupos } from "@/lib/catalogo-variantes-repo"
import { upsertProductos } from "@/lib/catalog-products-repo"
import { seedTenant, truncateAll } from "./helpers"

// `recalcularGrupos` (change `variantes-de-producto`, S2): grupo, etiqueta y representante de las
// variantes, contra Postgres real (crm_test). Datos inventados.

const T = "tenant-var"
const OTRO = "tenant-otro"

interface Fila {
  id: string
  tipo?: "simple" | "padre" | "variante"
  padre?: string | null
  opcion?: string | null
  stock?: number | null
  /** Precio online; null/0 = sin precio. */
  precio?: number | null
  status?: string
  alegraStatus?: string
  tenant?: string
}

async function sembrar(f: Fila) {
  const tenant = f.tenant ?? T
  const online = f.precio ? JSON.stringify([{ idPriceList: "lista-1", name: "Online", price: f.precio, main: true }]) : "[]"
  const variante = f.opcion ? JSON.stringify([{ atributo: "Color", opcion: f.opcion }]) : null
  await getDb().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, name, tipo, padre_alegra_id, variante, stock, status, alegra_status, precios_online)
    VALUES (${tenant}, ${f.id}, ${"Producto " + f.id}, ${f.tipo ?? "simple"}, ${f.padre ?? null}, ${variante}::jsonb,
            ${f.stock ?? null}, ${f.status ?? "active"}, ${f.alegraStatus ?? "active"}, ${online}::jsonb)
  `)
}

async function leer(id: string, tenant = T) {
  const rows = (await getDb().execute(
    sql`SELECT grupo_id, etiqueta, es_representante FROM catalog_products WHERE tenant_id = ${tenant} AND alegra_id = ${id}`,
  )) as unknown as { grupo_id: string | null; etiqueta: string | null; es_representante: boolean }[]
  return rows[0]
}

const representantes = async (grupo: string) =>
  (
    (await getDb().execute(
      sql`SELECT alegra_id FROM catalog_products WHERE tenant_id = ${T} AND grupo_id = ${grupo} AND es_representante ORDER BY alegra_id`,
    )) as unknown as { alegra_id: string }[]
  ).map((r) => r.alegra_id)

/** Un modelo "P" con tres colores. */
async function modelo(variantes: Omit<Fila, "tipo" | "padre">[], padre = "P") {
  await sembrar({ id: padre, tipo: "padre" })
  for (const v of variantes) await sembrar({ ...v, tipo: "variante", padre })
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
})

afterAll(async () => {
  await truncateAll()
})

describe("recalcularGrupos: grupo y etiqueta", () => {
  it("las variantes de un padre existente quedan en su grupo con la etiqueta de la opción", async () => {
    await modelo([
      { id: "v1", opcion: "Verde", precio: 100, stock: 3 },
      { id: "v2", opcion: "Rojo", precio: 100, stock: 3 },
    ])
    await recalcularGrupos(T)
    expect(await leer("v1")).toMatchObject({ grupo_id: "P", etiqueta: "Verde" })
    expect(await leer("v2")).toMatchObject({ grupo_id: "P", etiqueta: "Rojo" })
    expect((await leer("P")).grupo_id).toBeNull()
  })

  it("la variante huérfana (sin fila de padre) queda suelta y es representante de sí misma", async () => {
    await sembrar({ id: "h1", tipo: "variante", padre: "NO-EXISTE", opcion: "Azul", precio: 50, stock: 1 })
    await recalcularGrupos(T)
    expect(await leer("h1")).toMatchObject({ grupo_id: null, etiqueta: "Azul", es_representante: true })
  })

  it("el grupo se arma sólo con padres del mismo tenant", async () => {
    await sembrar({ id: "P", tipo: "padre", tenant: OTRO })
    await sembrar({ id: "v1", tipo: "variante", padre: "P", opcion: "Verde", precio: 10 })
    await recalcularGrupos(T)
    expect((await leer("v1")).grupo_id).toBeNull()
  })

  it("Avantec sin códigos: agrupa por padre_alegra_id, no por code", async () => {
    // Ningún ítem tiene `code`; el grupo sale únicamente del padre.
    await modelo([
      { id: "a1", opcion: "Blanco", precio: 90, stock: 1 },
      { id: "a2", opcion: "Negro", precio: 95, stock: 1 },
    ])
    const codes = (await getDb().execute(sql`SELECT count(*)::int AS n FROM catalog_products WHERE tenant_id = ${T} AND code IS NOT NULL`)) as unknown as { n: number }[]
    expect(codes[0].n).toBe(0)
    await recalcularGrupos(T)
    expect((await leer("a1")).grupo_id).toBe("P")
    expect((await leer("a2")).grupo_id).toBe("P")
  })
})

describe("recalcularGrupos: representante", () => {
  it("elige la vendible con stock y menor precio (Azul)", async () => {
    await modelo([
      { id: "verde", opcion: "Verde", precio: 100, stock: 0 },
      { id: "rojo", opcion: "Rojo", precio: 120, stock: 5 },
      { id: "azul", opcion: "Azul", precio: 110, stock: 5 },
    ])
    await recalcularGrupos(T)
    expect(await representantes("P")).toEqual(["azul"])
    expect((await leer("verde")).es_representante).toBe(false)
  })

  it("si el representante se agota, pasa la posta a otra con stock", async () => {
    await modelo([
      { id: "rojo", opcion: "Rojo", precio: 120, stock: 5 },
      { id: "azul", opcion: "Azul", precio: 110, stock: 5 },
    ])
    await recalcularGrupos(T)
    expect(await representantes("P")).toEqual(["azul"])
    await getDb().execute(sql`UPDATE catalog_products SET stock = 0 WHERE tenant_id = ${T} AND alegra_id = 'azul'`)
    await recalcularGrupos(T, { alegraIds: ["azul"] })
    expect(await representantes("P")).toEqual(["rojo"])
  })

  it("todas sin stock: gana la más barata con precio (el modelo no desaparece)", async () => {
    await modelo([
      { id: "verde", opcion: "Verde", precio: 100, stock: 0 },
      { id: "rojo", opcion: "Rojo", precio: 120, stock: 0 },
      { id: "sinprecio", opcion: "Negro", precio: null, stock: 0 },
    ])
    await recalcularGrupos(T)
    expect(await representantes("P")).toEqual(["verde"])
  })

  it("stock null (sin dato) no cuenta como agotado", async () => {
    await modelo([
      { id: "agotada", opcion: "Verde", precio: 90, stock: 0 },
      { id: "sindato", opcion: "Rojo", precio: 120, stock: null },
    ])
    await recalcularGrupos(T)
    expect(await representantes("P")).toEqual(["sindato"])
  })

  it("una inactiva (en Alegra o por la sync) deja de ser representante y la reemplaza otra", async () => {
    await modelo([
      { id: "rojo", opcion: "Rojo", precio: 120, stock: 5 },
      { id: "azul", opcion: "Azul", precio: 110, stock: 5 },
    ])
    await recalcularGrupos(T)
    expect(await representantes("P")).toEqual(["azul"])
    await getDb().execute(sql`UPDATE catalog_products SET alegra_status = 'inactive' WHERE tenant_id = ${T} AND alegra_id = 'azul'`)
    await recalcularGrupos(T)
    expect(await representantes("P")).toEqual(["rojo"])
    await getDb().execute(sql`UPDATE catalog_products SET status = 'inactive' WHERE tenant_id = ${T} AND alegra_id = 'rojo'`)
    await getDb().execute(sql`UPDATE catalog_products SET alegra_status = 'active' WHERE tenant_id = ${T} AND alegra_id = 'azul'`)
    await recalcularGrupos(T)
    expect(await representantes("P")).toEqual(["azul"])
  })

  it("'con precio' se mide sobre precios_online, no sobre los precios de Alegra", async () => {
    await modelo([{ id: "v1", opcion: "Verde", precio: 50, stock: 1 }, { id: "v2", opcion: "Rojo", precio: null, stock: 1 }])
    // v2 tiene precio en Alegra pero no online: no es vendible.
    await getDb().execute(sql`UPDATE catalog_products SET prices = '[{"idPriceList":"1","name":"General","price":10}]'::jsonb WHERE tenant_id = ${T} AND alegra_id = 'v2'`)
    await recalcularGrupos(T)
    expect(await representantes("P")).toEqual(["v1"])
  })

  it("el padre nunca es representante; los simples sí; los huérfanos también", async () => {
    await modelo([{ id: "v1", opcion: "Verde", precio: 50, stock: 1 }])
    await sembrar({ id: "s1", precio: 10, stock: 1 })
    await getDb().execute(sql`UPDATE catalog_products SET es_representante = true WHERE tenant_id = ${T} AND alegra_id = 'P'`)
    await getDb().execute(sql`UPDATE catalog_products SET es_representante = false WHERE tenant_id = ${T} AND alegra_id = 's1'`)
    await recalcularGrupos(T)
    expect((await leer("P")).es_representante).toBe(false)
    expect((await leer("s1")).es_representante).toBe(true)
    expect((await leer("v1")).es_representante).toBe(true)
  })

  it("empate total: desempata por alegra_id (estable)", async () => {
    await modelo([
      { id: "b", opcion: "B", precio: 100, stock: 1 },
      { id: "a", opcion: "A", precio: 100, stock: 1 },
    ])
    await recalcularGrupos(T)
    expect(await representantes("P")).toEqual(["a"])
  })
})

describe("recalcularGrupos: idempotencia y alcance", () => {
  it("dos corridas seguidas sin cambios: la segunda no modifica ninguna fila", async () => {
    await modelo([
      { id: "verde", opcion: "Verde", precio: 100, stock: 0 },
      { id: "rojo", opcion: "Rojo", precio: 120, stock: 5 },
    ])
    await sembrar({ id: "s1", precio: 10, stock: 1 })
    const primera = await recalcularGrupos(T)
    expect(primera.cambiados).toBeGreaterThan(0)
    expect(primera.grupos).toBe(1)
    const segunda = await recalcularGrupos(T)
    expect(segunda).toEqual({ grupos: 1, cambiados: 0 })
  })

  it("con alcance sólo toca los grupos de los ítems indicados", async () => {
    await modelo([{ id: "v1", opcion: "Verde", precio: 100, stock: 1 }], "P")
    await modelo([{ id: "w1", opcion: "Verde", precio: 100, stock: 1 }], "Q")
    const r = await recalcularGrupos(T, { alegraIds: ["v1"] })
    expect(r.grupos).toBe(1)
    expect((await leer("v1")).grupo_id).toBe("P")
    expect((await leer("w1")).grupo_id).toBeNull()
    await recalcularGrupos(T, { grupoIds: ["Q"] })
    expect((await leer("w1")).grupo_id).toBe("Q")
  })

  it("alcance vacío no hace nada", async () => {
    await modelo([{ id: "v1", opcion: "Verde", precio: 100, stock: 1 }])
    expect(await recalcularGrupos(T, { alegraIds: [] })).toEqual({ grupos: 0, cambiados: 0 })
    expect((await leer("v1")).grupo_id).toBeNull()
  })

  it("al llegar el padre después que sus hijos, recalcular por el id del padre agrupa a los hijos", async () => {
    await sembrar({ id: "v1", tipo: "variante", padre: "P", opcion: "Verde", precio: 100, stock: 1 })
    await recalcularGrupos(T)
    expect((await leer("v1")).grupo_id).toBeNull()
    await sembrar({ id: "P", tipo: "padre" })
    await recalcularGrupos(T, { alegraIds: ["P"] })
    expect((await leer("v1")).grupo_id).toBe("P")
  })

  it("no cruza tenants", async () => {
    await modelo([{ id: "v1", opcion: "Verde", precio: 100, stock: 1 }])
    await sembrar({ id: "x1", tenant: OTRO, tipo: "variante", padre: "P", opcion: "Verde" })
    await recalcularGrupos(T)
    expect((await leer("x1", OTRO)).grupo_id).toBeNull()
  })
})

// ── El upsert del espejo (sync y webhook) ────────────────────────────────────────────────────────

const item = (alegraId: string, extra: Partial<AlegraProduct> = {}): AlegraProduct => ({
  alegraId,
  code: null,
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

describe("upsertProductos: variantes", () => {
  const ahora = new Date("2026-10-11T12:00:00Z")
  const mas = (min: number) => new Date(ahora.getTime() + min * 60_000)

  it("persiste tipo, padre y opción, y recalcula el grupo de la variante tocada (webhook)", async () => {
    await upsertProductos(T, [item("P", { tipo: "padre", stock: null })], { leidoAt: ahora, leidoPor: "sync" })
    await upsertProductos(
      T,
      [item("v1", { tipo: "variante", padreAlegraId: "P", variante: [{ atributo: "Color", opcion: "Verde" }], varianteClave: "verde" })],
      { leidoAt: mas(1), leidoPor: "webhook" },
    )
    const r = (await getDb().execute(
      sql`SELECT tipo, padre_alegra_id, variante, variante_clave, grupo_id, etiqueta FROM catalog_products WHERE tenant_id = ${T} AND alegra_id = 'v1'`,
    )) as unknown as Record<string, unknown>[]
    expect(r[0]).toMatchObject({
      tipo: "variante",
      padre_alegra_id: "P",
      variante: [{ atributo: "Color", opcion: "Verde" }],
      variante_clave: "verde",
      grupo_id: "P",
      etiqueta: "Verde",
    })
  })

  it("el webhook de una variante conserva tipo, padre y opción cuando la re-lee, y recalcula el representante", async () => {
    const v = (id: string, precio: number, stock: number, leidoPor: "sync" | "webhook", t: Date, opcion: string) =>
      upsertProductos(
        T,
        [
          item(id, {
            tipo: "variante",
            padreAlegraId: "P",
            variante: [{ atributo: "Color", opcion }],
            varianteClave: opcion.toLowerCase(),
            stock,
          }),
        ],
        { leidoAt: t, leidoPor },
      ).then(() =>
        getDb().execute(
          sql`UPDATE catalog_products SET precios_online = ${JSON.stringify([{ idPriceList: "l", name: "Online", price: precio, main: true }])}::jsonb WHERE tenant_id = ${T} AND alegra_id = ${id}`,
        ),
      )
    await upsertProductos(T, [item("P", { tipo: "padre", stock: null })], { leidoAt: ahora, leidoPor: "sync" })
    await v("rojo", 120, 5, "sync", ahora, "Rojo")
    await v("azul", 110, 5, "sync", ahora, "Azul")
    await recalcularGrupos(T)
    expect(await representantes("P")).toEqual(["azul"])
    // El webhook re-lee Azul: se agotó. Conserva su tipo/padre/opción y Rojo pasa a ser representante.
    await upsertProductos(
      T,
      [item("azul", { tipo: "variante", padreAlegraId: "P", variante: [{ atributo: "Color", opcion: "Azul" }], varianteClave: "azul", stock: 0 })],
      { leidoAt: mas(5), leidoPor: "webhook" },
    )
    const azul = (await getDb().execute(
      sql`SELECT tipo, padre_alegra_id, variante_clave, grupo_id FROM catalog_products WHERE tenant_id = ${T} AND alegra_id = 'azul'`,
    )) as unknown as Record<string, unknown>[]
    expect(azul[0]).toMatchObject({ tipo: "variante", padre_alegra_id: "P", variante_clave: "azul", grupo_id: "P" })
    expect(await representantes("P")).toEqual(["rojo"])
  })

  it("una lectura vieja no pisa el tipo/padre/opción de una más nueva (frescura por fila)", async () => {
    await upsertProductos(T, [item("v1", { tipo: "variante", padreAlegraId: "P", varianteClave: "verde" })], { leidoAt: mas(10), leidoPor: "webhook" })
    await upsertProductos(T, [item("v1", { tipo: "simple", padreAlegraId: null, varianteClave: null })], { leidoAt: ahora, leidoPor: "sync" })
    const r = (await getDb().execute(sql`SELECT tipo, padre_alegra_id, variante_clave FROM catalog_products WHERE tenant_id = ${T} AND alegra_id = 'v1'`)) as unknown as Record<string, unknown>[]
    expect(r[0]).toMatchObject({ tipo: "variante", padre_alegra_id: "P", variante_clave: "verde" })
  })

  it("un ítem simple de la sync queda tipo 'simple' y representante", async () => {
    await upsertProductos(T, [item("s1")], { leidoAt: ahora, leidoPor: "sync" })
    expect(await leer("s1")).toMatchObject({ grupo_id: null, es_representante: true })
  })
})
