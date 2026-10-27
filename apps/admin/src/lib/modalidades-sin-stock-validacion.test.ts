import { describe, it, expect } from "vitest"
import { avisoPlazoSinFecha, textoPlazo, validarModalidad } from "@/lib/modalidades-sin-stock-validacion"

const base = { nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea", activa: true }

describe("validarModalidad", () => {
  it("acepta una modalidad en línea con plazo", () => {
    expect(validarModalidad({ nombre: " Modalidad 48 h ", texto: "Retiro en ~48 h", plazoDias: "2", flujo: "en_linea", activa: true })).toEqual({
      ok: true,
      modalidad: { nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea", activa: true },
    })
  })
  it("plazo null = a coordinar", () => expect(validarModalidad({ ...base, plazoDias: null }).ok).toBe(true))
  it.each([0, 61, 2.5, "x"])("rechaza el plazo %s", (p) =>
    expect(validarModalidad({ ...base, plazoDias: p })).toMatchObject({ ok: false, campo: "plazoDias" }),
  )
  it("rechaza un texto de más de 40", () => expect(validarModalidad({ ...base, texto: "x".repeat(41) })).toMatchObject({ ok: false, campo: "texto" }))
  it("rechaza un nombre vacío o de más de 60", () => {
    expect(validarModalidad({ ...base, nombre: "  " })).toMatchObject({ ok: false, campo: "nombre" })
    expect(validarModalidad({ ...base, nombre: "x".repeat(61) })).toMatchObject({ ok: false, campo: "nombre" })
  })
  it("rechaza un flujo desconocido", () => expect(validarModalidad({ ...base, flujo: "gratis" })).toMatchObject({ ok: false, campo: "flujo" }))
  it("rechaza activa no booleano y body no objeto", () => {
    expect(validarModalidad({ ...base, activa: "si" })).toMatchObject({ ok: false, campo: "activa" })
    expect(validarModalidad(null)).toMatchObject({ ok: false, campo: "body" })
  })
  it("avisa a coordinar + en línea", () => {
    expect(avisoPlazoSinFecha({ plazoDias: null, flujo: "en_linea" })).toMatch(/sin una fecha estimada/)
    expect(avisoPlazoSinFecha({ plazoDias: null, flujo: "a_confirmar" })).toBeNull()
    expect(avisoPlazoSinFecha({ plazoDias: 3, flujo: "en_linea" })).toBeNull()
  })
  it("textoPlazo", () => expect([textoPlazo(null), textoPlazo(1), textoPlazo(5)]).toEqual(["a coordinar", "1 día hábil", "5 días hábiles"]))
})
