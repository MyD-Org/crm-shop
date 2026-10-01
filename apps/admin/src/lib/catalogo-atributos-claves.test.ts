import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { CLAVES_ATRIBUTO } from "./catalogo-atributos-extraccion"

/**
 * Paridad de claves de `catalog_atributos`. La lista de 18 vive en un fixture compartido con el
 * Shop (`apps/clientes/src/db/__fixtures__/atributos-claves.json`) y el CHECK de la última
 * migración que lo toca tiene que listar exactamente esas claves. Tipo `num` ⇒ `valor_num`;
 * `texto` ⇒ `valor_texto`.
 */

const FIXTURE = fileURLToPath(new URL("../../../clientes/src/db/__fixtures__/atributos-claves.json", import.meta.url))
const DRIZZLE = fileURLToPath(new URL("../../drizzle", import.meta.url))

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  claves: string[]
  tipos: Record<string, "num" | "texto">
}

function literalesDelUltimoCheck(): { archivo: string; claves: string[] } {
  const archivos = readdirSync(DRIZZLE)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
  for (const archivo of archivos.reverse()) {
    // Sin los comentarios: el encabezado de 0053 cita el CHECK viejo en la reversa.
    const sql = readFileSync(path.join(DRIZZLE, archivo), "utf8").replace(/^--.*$/gm, "")
    const m = sql.match(/catalog_atributos_clave_check"\s*CHECK \("clave" IN \(([^)]*)\)\)/)
    if (m) return { archivo, claves: [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]) }
  }
  throw new Error("Ninguna migración define catalog_atributos_clave_check")
}

describe("paridad de claves de catalog_atributos", () => {
  it("el fixture tiene 18 claves únicas y un tipo por cada una", () => {
    expect(fixture.claves).toHaveLength(18)
    expect(new Set(fixture.claves).size).toBe(18)
    expect(Object.keys(fixture.tipos).sort()).toEqual([...fixture.claves].sort())
    for (const t of Object.values(fixture.tipos)) expect(["num", "texto"]).toContain(t)
  })

  it("las claves vigentes del CRM son el prefijo del fixture (las nuevas se agregan al final)", () => {
    expect(fixture.claves.slice(0, CLAVES_ATRIBUTO.length)).toEqual([...CLAVES_ATRIBUTO])
  })

  it("el CHECK de la última migración lista exactamente las claves del fixture", () => {
    const { archivo, claves } = literalesDelUltimoCheck()
    expect(archivo).toBe("0053_atributos_ampliados.sql")
    expect(new Set(claves)).toEqual(new Set(fixture.claves))
    expect(claves).toHaveLength(18)
  })
})
