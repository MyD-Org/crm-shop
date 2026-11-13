import { describe, it, expect } from "vitest"
import { configConHorario, horarioDeConfig, normalizarHorarioEntrega } from "./metodos-envio-horario"
import { validarMetodoEnvio } from "./metodos-envio-validacion"

const base = () => ({
  slug: "envio-rapido",
  nombre: "Envío rápido",
  provincia: "Buenos Aires",
  diasOperativos: [1, 2, 3, 4, 5],
  horaCorte: "09:00",
  zonas: [],
  localidades: [],
})

describe("horario de entrega: validación", () => {
  it("vacío o ausente = sin horario", () => {
    for (const v of [undefined, null, "", "   "]) {
      const r = validarMetodoEnvio({ ...base(), horarioEntrega: v })
      expect(r.ok && r.metodo.horarioEntrega).toBe("")
    }
  })
  it("recorta y junta espacios", () => {
    const r = validarMetodoEnvio({ ...base(), horarioEntrega: "  entre las 14   y las 21 hs " })
    expect(r.ok && r.metodo.horarioEntrega).toBe("entre las 14 y las 21 hs")
  })
  it("acepta 40 caracteres y rechaza 41", () => {
    expect(validarMetodoEnvio({ ...base(), horarioEntrega: "a".repeat(40) }).ok).toBe(true)
    const r = validarMetodoEnvio({ ...base(), horarioEntrega: "a".repeat(41) })
    expect(r).toMatchObject({ ok: false, campo: "horarioEntrega" })
    expect(!r.ok && r.error).toMatch(/hasta 40 caracteres/)
  })
  it("rechaza lo que no es texto", () => {
    expect(validarMetodoEnvio({ ...base(), horarioEntrega: 21 })).toMatchObject({ ok: false, campo: "horarioEntrega" })
  })
})

describe("horario de entrega en config", () => {
  it("normaliza", () => {
    expect(normalizarHorarioEntrega(" x ")).toBe("x")
  })
  it("se lee de config.horarioEntrega y tolera configs raras", () => {
    expect(horarioDeConfig({ horarioEntrega: "antes de las 21 hs" })).toBe("antes de las 21 hs")
    for (const c of [{}, null, undefined, "x", { horarioEntrega: 3 }]) expect(horarioDeConfig(c)).toBe("")
  })
  it("conserva las demás claves y quita la propia al vaciar", () => {
    expect(configConHorario({ otra: 1 }, "antes de las 21 hs")).toEqual({ otra: 1, horarioEntrega: "antes de las 21 hs" })
    expect(configConHorario({ otra: 1, horarioEntrega: "x" }, "")).toEqual({ otra: 1 })
    expect(configConHorario(null, "")).toEqual({})
  })
})
