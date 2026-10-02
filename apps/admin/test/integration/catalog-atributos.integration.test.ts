import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { sql as dsql } from "drizzle-orm"
import { getDb } from "@/db"
import {
  guardarAtributosManual,
  leerAtributos,
  reemplazarAtributosDeNombre,
  sincronizarAtributosDeNombre,
  upsertAtributos,
} from "@/lib/catalogo-atributos-repo"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0049 (catálogo asistido fase 2, subproyecto 5): `catalog_atributos` con la
 * precedencia manual > pdf > nombre aplicada por el upsert, los CHECK de clave/fuente y el GRANT
 * por columna a `shop_app` (mismo patrón que catalog-products-shop-grants: crea el rol NOLOGIN si
 * no existe, corre el bloque DO $$ leído del .sql y verifica como shop_app). Datos inventados.
 */

const A = "tenant-atr"
const MIGRACION = fileURLToPath(new URL("../../drizzle/0049_catalog_atributos.sql", import.meta.url))

function bloqueDeGrants(): string {
  const partes = readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
  const bloque = partes[partes.length - 1]
  if (!/DO \$\$/.test(bloque)) throw new Error("0049: no encontré el bloque DO $$ de los GRANTs")
  return bloque
}

const mapa = async (alegraId: string) =>
  Object.fromEntries((await leerAtributos(A, alegraId)).map((a) => [a.clave, [a.valorNum ?? a.valorTexto, a.fuente]]))

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
})
afterAll(async () => {
  await truncateAll()
})

describe("catalog_atributos: precedencia", () => {
  it("nombre escribe; pdf lo pisa; nombre no pisa a pdf; manual pisa a todo; pdf no pisa a manual", async () => {
    await reemplazarAtributosDeNombre(A, [{ alegraId: "1", name: "REFLECTOR LED 50W CALIDO", description: null }])
    expect(await mapa("1")).toEqual({ potencia_w: [50, "nombre"], tono: ["calido", "nombre"] })

    await upsertAtributos(A, [{ alegraId: "1", clave: "potencia_w", valorNum: 48, valorTexto: null }], "pdf")
    await reemplazarAtributosDeNombre(A, [{ alegraId: "1", name: "REFLECTOR LED 50W CALIDO", description: null }])
    expect(await mapa("1")).toEqual({ potencia_w: [48, "pdf"], tono: ["calido", "nombre"] })

    await guardarAtributosManual(A, "1", [{ clave: "potencia_w", valorNum: 45, valorTexto: null }], [])
    expect(await upsertAtributos(A, [{ alegraId: "1", clave: "potencia_w", valorNum: 48, valorTexto: null }], "pdf")).toBe(0)
    expect(await mapa("1")).toEqual({ potencia_w: [45, "manual"], tono: ["calido", "nombre"] })
  })

  it("renombrar el producto borra las filas 'nombre' que ya no salen, no las pdf/manual", async () => {
    await reemplazarAtributosDeNombre(A, [{ alegraId: "2", name: "PANEL 12W 3000K", description: null }])
    await upsertAtributos(A, [{ alegraId: "2", clave: "flujo_lm", valorNum: 900, valorTexto: null }], "pdf")
    const r = await reemplazarAtributosDeNombre(A, [{ alegraId: "2", name: "PANEL 18W", description: null }])
    expect(r.borradas).toBe(2)
    expect(await mapa("2")).toEqual({ potencia_w: [18, "nombre"], flujo_lm: [900, "pdf"] })
  })

  it("idempotente: la segunda corrida no escribe nada", async () => {
    const p = [{ alegraId: "3", name: "DICROICA 7W 6500K GU10", description: null }]
    expect((await reemplazarAtributosDeNombre(A, p)).escritas).toBe(4)
    expect(await reemplazarAtributosDeNombre(A, p)).toEqual({ escritas: 0, borradas: 0 })
  })

  it("claves ampliadas: manual de 'polos' no lo pisa el nombre; cambiar el nombre borra las 'nombre' que ya no salen", async () => {
    await reemplazarAtributosDeNombre(A, [{ alegraId: "5", name: "TERMICA 2X25A 6KA", description: null }])
    expect(await mapa("5")).toEqual({
      corriente_a: [25, "nombre"],
      polos: [2, "nombre"],
      poder_corte_ka: [6, "nombre"],
    })

    await guardarAtributosManual(A, "5", [{ clave: "polos", valorNum: 3, valorTexto: null }], [])
    await reemplazarAtributosDeNombre(A, [{ alegraId: "5", name: "TERMICA 2X25A 6KA", description: null }])
    expect((await mapa("5")).polos).toEqual([3, "manual"])

    // El nombre cambia: las filas 'nombre' que ya no salen se borran; la manual de polos se conserva.
    await reemplazarAtributosDeNombre(A, [{ alegraId: "5", name: "TERMICA", description: null }])
    expect(await mapa("5")).toEqual({ polos: [3, "manual"] })
  })

  it("el hook de la sync no tira aunque falle la base", async () => {
    await getDb().execute(dsql`ALTER TABLE catalog_atributos RENAME TO catalog_atributos_x`)
    try {
      await expect(sincronizarAtributosDeNombre(A, [{ alegraId: "4", name: "LAMPARA 9W", description: null }], "test")).resolves.toBeUndefined()
    } finally {
      await getDb().execute(dsql`ALTER TABLE catalog_atributos_x RENAME TO catalog_atributos`)
    }
  })

  it("CHECK de clave y fuente", async () => {
    await expect(
      getDb().execute(dsql`INSERT INTO catalog_atributos (tenant_id, alegra_id, clave, valor_num, fuente) VALUES (${A}, '5', 'inventada', 1, 'nombre')`),
    ).rejects.toThrow()
    await expect(
      getDb().execute(dsql`INSERT INTO catalog_atributos (tenant_id, alegra_id, clave, valor_num, fuente) VALUES (${A}, '5', 'ip', 65, 'ia')`),
    ).rejects.toThrow()
  })
})

describe("catalog_atributos: CHECK de clave ampliado (0053, 0058, 0059)", () => {
  const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../clientes/src/db/__fixtures__/atributos-claves.json", import.meta.url)), "utf8"),
  ) as { claves: string[]; tipos: Record<string, "num" | "texto"> }
  const NUEVAS = fixture.claves.slice(7)

  it("la base migrada admite exactamente las 21 claves del fixture", async () => {
    const filas = await getDb().execute<{ def: string }>(
      dsql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'catalog_atributos_clave_check' AND conrelid = 'public.catalog_atributos'::regclass`,
    )
    const claves = [...String(filas[0].def).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
    expect(new Set(claves)).toEqual(new Set(fixture.claves))
    expect(claves).toHaveLength(21)
  })

  it("acepta una fila por cada una de las 14 claves nuevas", async () => {
    expect(NUEVAS).toHaveLength(14)
    for (const clave of NUEVAS) {
      const num = fixture.tipos[clave] === "num"
      await getDb().execute(
        dsql`INSERT INTO catalog_atributos (tenant_id, alegra_id, clave, valor_num, valor_texto, fuente) VALUES (${A}, '9', ${clave}, ${num ? 1 : null}, ${num ? null : "x"}, 'manual')`,
      )
    }
    expect((await leerAtributos(A, "9")).map((a) => a.clave).sort()).toEqual([...NUEVAS].sort())
  })

  it("rechaza claves fuera del vocabulario", async () => {
    for (const clave of ["material", "rgb", "modulos", "diametro_mm"]) {
      await expect(
        getDb().execute(dsql`INSERT INTO catalog_atributos (tenant_id, alegra_id, clave, valor_num, fuente) VALUES (${A}, '9', ${clave}, 1, 'manual')`),
      ).rejects.toThrow()
    }
  })

  it("las 7 claves previas siguen válidas", async () => {
    for (const clave of fixture.claves.slice(0, 7)) {
      const num = fixture.tipos[clave] === "num"
      await getDb().execute(
        dsql`INSERT INTO catalog_atributos (tenant_id, alegra_id, clave, valor_num, valor_texto, fuente) VALUES (${A}, '8', ${clave}, ${num ? 1 : null}, ${num ? null : "x"}, 'manual')`,
      )
    }
    expect(await leerAtributos(A, "8")).toHaveLength(7)
  })
})

describe("catalog_atributos: GRANT por columna a shop_app", () => {
  let sql: postgres.Sql
  let rolCreadoAca = false

  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await sql.unsafe(bloqueDeGrants())
  })
  afterAll(async () => {
    if (rolCreadoAca) {
      await sql.unsafe("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM shop_app").catch(() => {})
      await sql.unsafe("REVOKE USAGE ON SCHEMA public FROM shop_app").catch(() => {})
      await sql.unsafe("DROP ROLE IF EXISTS shop_app").catch(() => {})
    }
    await sql.end()
  })

  async function comoShopApp(stmt: string): Promise<{ ok: boolean; code?: string }> {
    const ROLLBACK = new Error("rollback")
    let r: { ok: boolean; code?: string } = { ok: false }
    await sql
      .begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE shop_app")
        try {
          await tx.unsafe(stmt)
          r = { ok: true }
        } catch (e) {
          r = { ok: false, code: (e as { code?: string }).code }
        }
        throw ROLLBACK
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e
      })
    return r
  }

  it("lee las 5 columnas concedidas; fuente/updated_at y escribir → permission denied", async () => {
    expect(await comoShopApp("SELECT tenant_id, alegra_id, clave, valor_num, valor_texto FROM public.catalog_atributos")).toEqual({ ok: true })
    expect(await comoShopApp("SELECT fuente FROM public.catalog_atributos")).toEqual({ ok: false, code: "42501" })
    expect(await comoShopApp("SELECT updated_at FROM public.catalog_atributos")).toEqual({ ok: false, code: "42501" })
    expect(
      await comoShopApp("INSERT INTO public.catalog_atributos (tenant_id, alegra_id, clave, valor_num, fuente) VALUES ('x','1','ip',65,'manual')"),
    ).toEqual({ ok: false, code: "42501" })
  })
})
