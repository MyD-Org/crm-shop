import { describe, it, expect } from "vitest"
import { claveTexto } from "./texto-clave"

describe("claveTexto", () => {
  it("ignora tildes, mayúsculas, espacios y signos", () => {
    expect(claveTexto("  Ciudad  Ejemplo ")).toBe("ciudadejemplo")
    expect(claveTexto("Córdoba")).toBe("cordoba")
    expect(claveTexto("Mar del Plata (B.A.)")).toBe("mardelplataba")
  })
  it("texto vacío o solo signos da vacío", () => {
    expect(claveTexto("")).toBe("")
    expect(claveTexto(" - . ")).toBe("")
  })
})
