import { describe, expect, it } from "vitest"
import { ciudadesATexto, textoACiudades } from "./envios-sucursales"

describe("ciudades de envío", () => {
  it("separa por coma, recorta y descarta vacíos", () => {
    expect(textoACiudades(" Rosario ,, Funes,  ")).toEqual(["Rosario", "Funes"])
  })
  it("texto vacío = toda la zona (lista vacía)", () => {
    expect(textoACiudades("")).toEqual([])
    expect(textoACiudades("  ,  ")).toEqual([])
  })
  it("ida y vuelta", () => {
    expect(textoACiudades(ciudadesATexto(["Rosario", "Funes"]))).toEqual(["Rosario", "Funes"])
  })
})
