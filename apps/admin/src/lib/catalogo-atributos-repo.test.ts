import { describe, expect, it } from "vitest"
import { filasDeNombre, puedePisar, RANGO_FUENTE } from "./catalogo-atributos-repo"

// El SQL del upsert (precedencia en el ON CONFLICT … WHERE) se prueba contra Postgres en
// test/integration/catalog-atributos.integration.test.ts. Acá, la regla y el armado de filas.

describe("precedencia de fuentes: manual > pdf > nombre", () => {
  it("una fuente pisa a otra de igual o menor precedencia, nunca a una mayor", () => {
    expect(RANGO_FUENTE.manual).toBeGreaterThan(RANGO_FUENTE.pdf)
    expect(RANGO_FUENTE.pdf).toBeGreaterThan(RANGO_FUENTE.nombre)
    expect(puedePisar("nombre", "nombre")).toBe(true)
    expect(puedePisar("nombre", "pdf")).toBe(false)
    expect(puedePisar("nombre", "manual")).toBe(false)
    expect(puedePisar("pdf", "nombre")).toBe(true)
    expect(puedePisar("pdf", "manual")).toBe(false)
    expect(puedePisar("manual", "pdf")).toBe(true)
  })
})

describe("filasDeNombre", () => {
  it("arma una fila por atributo extraído, con el alegraId del producto", () => {
    expect(
      filasDeNombre([
        { alegraId: "10", name: "REFLECTOR LED 50W CALIDO", description: null },
        { alegraId: "11", name: "CINTA AISLADORA", description: null },
      ]),
    ).toEqual([
      { alegraId: "10", clave: "potencia_w", valorNum: 50, valorTexto: null },
      { alegraId: "10", clave: "tono", valorNum: null, valorTexto: "calido" },
    ])
  })
})
