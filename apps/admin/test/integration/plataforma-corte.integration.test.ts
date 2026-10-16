import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { sql } from "drizzle-orm"
import postgres from "postgres"
import { getDb } from "@/db"
import { TEST_DATABASE_URL } from "./db-url"
import { truncateAll, seedTenant } from "./helpers"
import { upsertProyeccion } from "@/lib/plataforma-proyeccion-repo"

/**
 * Corte 0091: `catalog_atributos` pasa a ser una VISTA sobre la proyección de la plataforma (las
 * mismas cinco columnas que el Shop lee desde 0049) y la tabla vieja queda como
 * `catalog_atributos_legacy`, sin permisos para `shop_app`. Reemplaza al describe de GRANT de
 * `catalog-atributos.integration.test.ts` (que verificaba 0049 sobre la tabla).
 */

const T = "central-led"
const MIGRACION = readFileSync(fileURLToPath(new URL("../../drizzle/0091_plataforma_corte_atributos.sql", import.meta.url)), "utf8").split("--> statement-breakpoint")
const bloque = (re: RegExp) => {
  const b = MIGRACION.find((s) => re.test(s))
  if (!b) throw new Error(`0091: no encontré el bloque ${re}`)
  return b
}

/** Corre cada consulta como shop_app (cliente propio, SET LOCAL ROLE, rollback siempre) y devuelve filas o el código de error. */
async function comoShopApp(consultas: string[]): Promise<({ filas: unknown[] } | { code: string })[]> {
  const cliente = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
  const ROLLBACK = new Error("rollback")
  const out: ({ filas: unknown[] } | { code: string })[] = []
  try {
    await cliente.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE shop_app")
      for (const q of consultas) {
        await tx.unsafe("SAVEPOINT s")
        try {
          out.push({ filas: [...(await tx.unsafe(q))] })
        } catch (e) {
          out.push({ code: (e as { code?: string }).code ?? "?" })
        } finally {
          await tx.unsafe("ROLLBACK TO SAVEPOINT s")
        }
      }
      throw ROLLBACK
    })
  } catch (e) {
    if (e !== ROLLBACK) throw e
  } finally {
    await cliente.end()
  }
  return out
}

describe("corte 0091: catalog_atributos es una vista sobre la proyección", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T)
  })

  it("el Shop lee catalog_atributos con las cinco columnas de siempre y ve la proyección; la tabla vieja no es legible", async () => {
    await upsertProyeccion(T, "atributos_tecnicos", "42", "i", { potencia_w: { n: 20, t: null }, fuentes: { potencia_w: "pdf" } }, new Date())
    // Los roles de test se crean DESPUÉS de migrar la plantilla: los bloques condicionales se corren acá.
    // Para probar el REVOKE, la tabla vieja arranca con el SELECT que le daba 0049.
    await getDb().execute(sql`GRANT SELECT ("tenant_id", "alegra_id", "clave", "valor_num", "valor_texto") ON "public"."catalog_atributos_legacy" TO shop_app`)
    await getDb().execute(sql.raw(bloque(/^DO \$\$[\s\S]*REVOKE ALL/m)))
    await getDb().execute(sql.raw(bloque(/^DO \$\$[\s\S]*GRANT SELECT/m)))

    const [vista, fuente, legacy, escribir] = await comoShopApp([
      `select tenant_id, alegra_id, clave, valor_num::text as valor_num, valor_texto from catalog_atributos where tenant_id = '${T}'`,
      "select fuente from catalog_atributos limit 1",
      "select tenant_id from catalog_atributos_legacy limit 1",
      `insert into catalog_atributos (tenant_id, alegra_id, clave, valor_num) values ('${T}', '1', 'ip', 65)`,
    ])
    expect(vista).toEqual({ filas: [{ tenant_id: T, alegra_id: "42", clave: "potencia_w", valor_num: "20", valor_texto: null }] })
    expect(fuente).toEqual({ code: "42703" }) // la columna no existe en la vista
    expect(legacy).toEqual({ code: "42501" })
    expect(escribir).toEqual({ code: "55000" }) // la vista no es actualizable (se chequea antes que el permiso)
  })

  it("la vista expone exactamente las cinco columnas y refleja catalog_atributos_shop", async () => {
    const cols = await getDb().execute(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'catalog_atributos' order by ordinal_position`,
    )
    expect(cols.map((c) => c.column_name)).toEqual(["tenant_id", "alegra_id", "clave", "valor_num", "valor_texto"])
    const [tipo] = await getDb().execute(sql`select table_type from information_schema.tables where table_schema = 'public' and table_name = 'catalog_atributos'`)
    expect(tipo.table_type).toBe("VIEW")

    await upsertProyeccion(T, "atributos_tecnicos", "7", "i", { tono: { n: null, t: "calido" }, ip: { n: 65, t: null }, fuentes: { tono: "nombre", ip: "pdf" } }, new Date())
    const deVista = await getDb().execute(sql`select alegra_id, clave, valor_num::text as n, valor_texto from catalog_atributos where tenant_id = ${T} order by clave`)
    const deShop = await getDb().execute(sql`select alegra_id, clave, valor_num::text as n, valor_texto from catalog_atributos_shop where tenant_id = ${T} order by clave`)
    expect(deVista).toEqual(deShop)
    expect(deVista).toHaveLength(2)
  })

  it("la tabla vieja conserva PK, CHECK y FK (renombrada como la nombra el snapshot de drizzle)", async () => {
    const filas = await getDb().execute(
      sql`select conname from pg_constraint where conrelid = 'public.catalog_atributos_legacy'::regclass order by conname`,
    )
    expect(filas.map((f) => f.conname)).toEqual([
      "catalog_atributos_clave_check",
      "catalog_atributos_fuente_check",
      "catalog_atributos_legacy_tenant_id_tenants_id_fk",
      "catalog_atributos_pk",
      "catalog_atributos_valor_check",
    ])
  })
})
