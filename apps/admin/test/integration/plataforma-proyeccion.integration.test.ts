import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import postgres from "postgres"
import { TEST_DATABASE_URL } from "./db-url"
import { getDb } from "@/db"
import { truncateAll, seedTenant } from "./helpers"
import { registrarEntrega, upsertProyeccion, upsertSpecProyectada, leerCursorProductos, guardarCursorProductos } from "@/lib/plataforma-proyeccion-repo"

const T = "central-led"
const atributos = (potencia: number) => ({ potencia_w: { n: potencia, t: null }, tension_v: { n: 220, t: "85-265" }, fuentes: { potencia_w: "pdf", tension_v: "nombre" } })

describe("proyección de la plataforma (0090)", () => {
  beforeEach(async () => { await truncateAll(); await seedTenant(T) })

  it("registrarEntrega es idempotente por delivery id", async () => {
    expect(await registrarEntrega(T, "d1", "e1", "atributos_tecnicos:create")).toBe(true)
    expect(await registrarEntrega(T, "d1", "e1", "atributos_tecnicos:create")).toBe(false)
  })

  it("upsertProyeccion: gana updated_at mayor; una entrega vieja no pisa", async () => {
    const nueva = new Date("2026-10-15T12:00:00Z"), vieja = new Date("2026-10-15T11:00:00Z")
    expect(await upsertProyeccion(T, "atributos_tecnicos", "42", "i-1", atributos(20), nueva)).toBe("escrita")
    expect(await upsertProyeccion(T, "atributos_tecnicos", "42", "i-1", atributos(18), vieja)).toBe("vieja")
    const [fila] = await getDb().execute(sql`select data->'potencia_w'->>'n' as n from catalog_proyeccion where tenant_id = ${T} and spec = 'atributos_tecnicos' and external_key = '42'`)
    expect(fila.n).toBe("20")
  })

  it("la vista catalog_atributos_shop desarma el jsonb en filas (n, t) y nunca expone `fuentes`", async () => {
    await upsertProyeccion(T, "atributos_tecnicos", "42", "i-1", atributos(20), new Date())
    const filas = await getDb().execute(sql`select alegra_id, clave, valor_num::text as valor_num, valor_texto from catalog_atributos_shop where tenant_id = ${T} order by clave`)
    expect(filas).toEqual([
      { alegra_id: "42", clave: "potencia_w", valor_num: "20", valor_texto: null },
      { alegra_id: "42", clave: "tension_v", valor_num: "220", valor_texto: "85-265" },
    ])
  })

  it("specs y cursor", async () => {
    await upsertSpecProyectada(T, "atributos_tecnicos", 1, { slug: "atributos_tecnicos", version: 1, fields: {} })
    await upsertSpecProyectada(T, "atributos_tecnicos", 2, { slug: "atributos_tecnicos", version: 2, fields: {} })
    const [s] = await getDb().execute(sql`select version from catalog_specs where tenant_id = ${T} and slug = 'atributos_tecnicos'`)
    expect(s.version).toBe(2)
    expect(await leerCursorProductos(T)).toEqual({ at: new Date(0), clave: "" })
    await guardarCursorProductos(T, { at: new Date("2026-10-15T00:00:00Z"), clave: "42" })
    const c = await leerCursorProductos(T)
    expect(c.at.toISOString()).toBe("2026-10-15T00:00:00.000Z")
    expect(c.clave).toBe("42")
  })

  it("grants: shop_app lee la vista y las columnas de catalog_specs, no la tabla de proyección", async () => {
    const sqlMig = readFileSync("drizzle/0090_plataforma_proyeccion.sql", "utf8").split("--> statement-breakpoint")
    await getDb().execute(sql.raw(sqlMig[sqlMig.length - 1]))
    // Mismo patrón que los otros tests de grants: cliente postgres directo, SET LOCAL ROLE y rollback siempre.
    const cliente = postgres(TEST_DATABASE_URL, { max: 1 })
    const ROLLBACK = new Error("rollback")
    const intentar = async (tx: postgres.TransactionSql, q: string): Promise<string | null> => {
      await tx.unsafe("SAVEPOINT s")
      try { await tx.unsafe(q); return null } catch (e) { return (e as { code?: string }).code ?? "?" } finally { await tx.unsafe("ROLLBACK TO SAVEPOINT s") }
    }
    try {
      await cliente.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE shop_app")
        expect(await intentar(tx, "select tenant_id, alegra_id, clave, valor_num, valor_texto from catalog_atributos_shop limit 0")).toBeNull()
        expect(await intentar(tx, "select tenant_id, slug, version, document from catalog_specs limit 0")).toBeNull()
        for (const t of ["catalog_proyeccion", "plataforma_entregas", "plataforma_sync_estado"]) {
          expect(await intentar(tx, `select 1 from ${t} limit 0`), t).toBe("42501")
        }
        throw ROLLBACK
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    } finally {
      await cliente.end()
    }
  })
})
