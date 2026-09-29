import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import casos from "./__fixtures__/sucursales-casos.json"
import {
  asignarSucursal,
  claveProvinciaZona,
  resolverZona,
  type SucursalDato,
  type ZonaDato,
} from "./sucursales-zona"

type Dataset = { sucursales: SucursalDato[]; zonas: ZonaDato[] }
const datasets = casos.datasets as Record<string, Dataset>

describe("fixture compartido con el Shop", () => {
  it("es idéntico byte a byte al del Shop (si cambia uno, cambia el otro)", () => {
    // Ruta relativa al repo: el cwd de vitest es apps/admin.
    const propio = readFileSync(join(process.cwd(), "src/lib/__fixtures__/sucursales-casos.json"))
    const delShop = readFileSync(join(process.cwd(), "../clientes/src/lib/__fixtures__/sucursales-casos.json"))
    expect(propio.equals(delShop)).toBe(true)
  })
})

describe("resolverZona (fixture compartido con el Shop)", () => {
  for (const c of casos.resolverZona) {
    it(c.caso, () => {
      const d = datasets[c.dataset]
      expect(resolverZona(c.provincia, d.zonas, d.sucursales)).toEqual(c.esperado)
    })
  }
})

describe("asignarSucursal (fixture compartido con el Shop)", () => {
  for (const c of casos.asignarSucursal) {
    it(c.caso, () => {
      const d = datasets[c.dataset]
      expect(asignarSucursal(c.entrada as never, d)).toEqual(c.esperado)
    })
  }
})

describe("determinismo", () => {
  it("las mismas reglas y la misma entrada dan exactamente el mismo resultado", () => {
    const d = datasets.base
    const entrada = { entregaTipo: "envio" as const, provincia: "Misiones", ciudad: "Puerto Iguazú" }
    expect(JSON.stringify(asignarSucursal(entrada, d))).toBe(JSON.stringify(asignarSucursal(entrada, d)))
  })

  it("no muta los datos de entrada", () => {
    const d = structuredClone(datasets.base)
    asignarSucursal({ entregaTipo: "envio", provincia: "Misiones", ciudad: "El Dorado" }, d)
    expect(d).toEqual(datasets.base)
  })
})

describe("claveProvinciaZona", () => {
  it("normaliza acentos, mayúsculas, espacios y alias de CABA", () => {
    expect(claveProvinciaZona(" TUCUMÁN ")).toBe("tucuman")
    expect(claveProvinciaZona("CABA")).toBe("ciudadautonomadebuenosaires")
    expect(claveProvinciaZona("Narnia")).toBe("")
    expect(claveProvinciaZona(null)).toBe("")
  })
})
