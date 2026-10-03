import { describe, expect, it } from "vitest"
import { fechaCorreo, fusionarHilos, nombreRemitente, tamanoLegible } from "./correo-formato"

describe("formato del correo", () => {
  it("nombreRemitente: nombre, o la dirección si no hay", () => {
    expect(nombreRemitente("Ana Prueba <ana@clientes.example>")).toBe("Ana Prueba")
    expect(nombreRemitente('"Ana, Prueba" <ana@clientes.example>')).toBe("Ana, Prueba")
    expect(nombreRemitente("<ana@clientes.example>")).toBe("ana@clientes.example")
    expect(nombreRemitente("beto@clientes.example")).toBe("beto@clientes.example")
  })

  it("tamanoLegible", () => {
    expect(tamanoLegible(500)).toBe("500 B")
    expect(tamanoLegible(120400)).toBe("118 KB")
    expect(tamanoLegible(1365037)).toBe("1.3 MB")
  })

  it("fusionarHilos no duplica los que ya estaban (Cargar más)", () => {
    const a = [{ id: "1" }, { id: "2" }]
    expect(fusionarHilos(a, [{ id: "2" }, { id: "3" }]).map((h) => h.id)).toEqual(["1", "2", "3"])
  })

  it("fechaCorreo: hora si es de hoy (hora de Buenos Aires), fecha si no", () => {
    const ahora = new Date("2026-10-03T18:00:00Z")
    expect(fechaCorreo("2026-10-03T14:27:00Z", ahora)).toBe("11:27")
    expect(fechaCorreo("2026-10-01T14:27:00Z", ahora)).toBe("01/10")
    expect(fechaCorreo("2025-12-01T14:27:00Z", ahora)).toBe("01/12/25")
    expect(fechaCorreo("basura", ahora)).toBe("")
  })
})
