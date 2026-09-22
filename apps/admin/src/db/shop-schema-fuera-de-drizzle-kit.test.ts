import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

// Guarda de ADM-11: el CRM NUNCA es dueño del DDL del esquema `shop`.
//
// `src/db/shop-schema.ts` declara tablas del Shop para poder consultarlas, pero si algún día
// drizzle-kit las "ve" (porque alguien las re-exporta desde schema.ts, o cambia el config a un
// glob), el próximo `db:generate` crea una migración del CRM con `CREATE SCHEMA "shop"` y
// `CREATE TABLE "shop"."orders"`. Aplicada a prod chocaría con las tablas reales del Shop.
// Este test es estático (lee archivos): corre en CI sin base.

const raiz = fileURLToPath(new URL("../..", import.meta.url))
const leer = (rel: string) => readFileSync(path.join(raiz, rel), "utf8")

describe("shop-schema queda fuera de drizzle-kit", () => {
  it("el snapshot más nuevo del CRM no conoce el esquema shop", () => {
    const meta = path.join(raiz, "drizzle/meta")
    const snapshots = readdirSync(meta).filter((f) => /^\d+_snapshot\.json$/.test(f)).sort()
    expect(snapshots.length).toBeGreaterThan(0)
    const ultimo = JSON.parse(readFileSync(path.join(meta, snapshots[snapshots.length - 1]), "utf8")) as {
      tables: Record<string, { schema?: string }>
      schemas: Record<string, unknown>
    }

    expect(ultimo.schemas).toEqual({})
    const tablasShop = Object.entries(ultimo.tables).filter(
      ([clave, tabla]) => clave.startsWith("shop.") || tabla.schema === "shop",
    )
    expect(tablasShop.map(([clave]) => clave)).toEqual([])
  })

  it("ninguna migración del CRM menciona el esquema shop", () => {
    const dir = path.join(raiz, "drizzle")
    const culpables = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => /"shop"\./.test(readFileSync(path.join(dir, f), "utf8")))
    expect(culpables).toEqual([])
  })

  it("src/db/schema.ts no importa ni re-exporta shop-schema", () => {
    expect(leer("src/db/schema.ts")).not.toContain("shop-schema")
  })

  it("drizzle.config.ts apunta a un único archivo de schema (ni glob ni lista)", () => {
    const config = leer("drizzle.config.ts")
    const declaraciones = config.match(/^\s*schema\s*:.*$/gm) ?? []
    expect(declaraciones).toHaveLength(1)
    expect(declaraciones[0]).toMatch(/schema:\s*"\.\/src\/db\/schema\.ts"\s*,/)
    expect(config).not.toContain("shop-schema")
  })
})
