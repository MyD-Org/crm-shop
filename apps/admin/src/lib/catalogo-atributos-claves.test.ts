import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { CLAVES_ATRIBUTO, DEFINICION_ATRIBUTOS, ETIQUETA_ATRIBUTO, normalizarAtributos } from "./catalogo-atributos-extraccion"
import { DESCRIPCION_PDF, HERRAMIENTA_ATRIBUTOS } from "./catalogo-atributos-pdf"

/**
 * Paridad de claves de `catalog_atributos`. La lista de 20 vive en un fixture compartido con el
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
  it("el fixture tiene 20 claves únicas y un tipo por cada una", () => {
    expect(fixture.claves).toHaveLength(20)
    expect(new Set(fixture.claves).size).toBe(20)
    expect(Object.keys(fixture.tipos).sort()).toEqual([...fixture.claves].sort())
    for (const t of Object.values(fixture.tipos)) expect(["num", "texto"]).toContain(t)
  })

  it("CLAVES_ATRIBUTO del CRM == fixture (mismo orden)", () => {
    expect([...CLAVES_ATRIBUTO]).toEqual(fixture.claves)
  })

  it("DEFINICION_ATRIBUTOS: mismas claves y mismo tipo que el fixture", () => {
    expect(Object.keys(DEFINICION_ATRIBUTOS).sort()).toEqual([...fixture.claves].sort())
    for (const c of CLAVES_ATRIBUTO) expect(DEFINICION_ATRIBUTOS[c].tipo).toBe(fixture.tipos[c])
    expect(Object.keys(ETIQUETA_ATRIBUTO).sort()).toEqual([...fixture.claves].sort())
  })

  it("la herramienta del PDF (esquema cerrado) tiene exactamente las claves del fixture, todas requeridas", () => {
    const s = HERRAMIENTA_ATRIBUTOS.input_schema
    expect(s.additionalProperties).toBe(false)
    expect(Object.keys(s.properties).sort()).toEqual([...fixture.claves].sort())
    expect([...s.required].sort()).toEqual([...fixture.claves].sort())
    expect(Object.keys(DESCRIPCION_PDF).sort()).toEqual([...fixture.claves].sort())
    for (const c of CLAVES_ATRIBUTO) {
      const tipo = (s.properties as Record<string, { type: string[] }>)[c].type
      // La tensión es num en la base pero el modelo puede devolver un rango de texto ("85-265").
      expect(tipo).toEqual([fixture.tipos[c] === "num" && c !== "tension_v" ? "number" : "string", "null"])
    }
  })

  it("normalizarAtributos acepta una muestra válida por cada clave (ninguna quedó sin rama)", () => {
    const muestras: Record<string, unknown> = {
      potencia_w: 50, temperatura_k: 3000, tono: "calido", ip: 65, flujo_lm: 1000, tension_v: 220, zocalo: "E27",
      corriente_a: 25, polos: 2, seccion_mm2: 2.5, medidas_mm: "300x1200", color: "blanco", poder_corte_ka: 6,
      curva: "C", sensibilidad_ma: 30, largo_m: 100, montaje: "embutir", angulo_grados: 60,
      leds_m: 120, potencia_w_m: 14.4,
    }
    expect(Object.keys(muestras).sort()).toEqual([...fixture.claves].sort())
    for (const c of CLAVES_ATRIBUTO) {
      const r = normalizarAtributos({ [c]: muestras[c] }).find((a) => a.clave === c)
      expect(r, c).toBeDefined()
      expect(r!.valorNum != null).toBe(fixture.tipos[c] === "num" || c === "tension_v")
    }
  })

  it("el CHECK de la última migración lista exactamente las claves del fixture", () => {
    const { archivo, claves } = literalesDelUltimoCheck()
    expect(archivo).toBe("0058_atributos_por_metro.sql")
    expect(new Set(claves)).toEqual(new Set(fixture.claves))
    expect(claves).toHaveLength(20)
  })
})
