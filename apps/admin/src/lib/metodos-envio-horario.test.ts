import { describe, it, expect } from "vitest"
import { configConHorario, esFechaIso, feriadosDeConfig, horarioDeConfig, normalizarFeriados, normalizarHorarioEntrega } from "./metodos-envio-horario"
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

describe("feriados del método", () => {
  it("fechas reales en formato AAAA-MM-DD", () => {
    expect(esFechaIso("2026-11-16")).toBe(true)
    for (const f of ["2026-02-30", "2026-13-01", "16/11/2026", "2026-1-5", "", null, 5, "1999-01-01"]) expect(esFechaIso(f)).toBe(false)
  })
  it("se validan, ordenan y quitan duplicados; ausente es lista vacía", () => {
    expect(normalizarFeriados(undefined)).toEqual([])
    expect(normalizarFeriados(["2026-12-08", " 2026-11-16 ", "2026-12-08"])).toEqual(["2026-11-16", "2026-12-08"])
  })
  it("rechaza lo que no es lista, una fecha inválida o más de 60", () => {
    expect(normalizarFeriados("2026-11-16")).toBeNull()
    expect(normalizarFeriados(["2026-11-16", "mañana"])).toBeNull()
    const dias = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10))
    expect(normalizarFeriados(dias(60))).toHaveLength(60)
    expect(normalizarFeriados(dias(61))).toBeNull()
  })
  it("la validación del método los devuelve ordenados y rechaza los inválidos", () => {
    const r = validarMetodoEnvio({ ...base(), feriados: ["2026-12-08", "2026-11-16"] })
    expect(r.ok && r.metodo.feriados).toEqual(["2026-11-16", "2026-12-08"])
    expect(validarMetodoEnvio({ ...base() })).toMatchObject({ ok: true, metodo: { feriados: [] } })
    expect(validarMetodoEnvio({ ...base(), feriados: ["2026-02-31"] })).toMatchObject({ ok: false, campo: "feriados" })
  })
  it("se leen de config.feriados tolerando basura", () => {
    expect(feriadosDeConfig({ feriados: ["2026-12-08", "x", "2026-11-16", "2026-11-16"] })).toEqual(["2026-11-16", "2026-12-08"])
    for (const c of [null, {}, { feriados: "x" }, { feriados: 3 }]) expect(feriadosDeConfig(c)).toEqual([])
  })
  it("al guardar conserva el resto de la config y quita la clave si no quedan feriados", () => {
    expect(configConHorario({ otra: 1 }, "", ["2026-11-16"])).toEqual({ otra: 1, feriados: ["2026-11-16"] })
    expect(configConHorario({ otra: 1, feriados: ["2026-11-16"] }, "", [])).toEqual({ otra: 1 })
    expect(configConHorario({ feriados: ["2026-11-16"] }, "x")).toEqual({ horarioEntrega: "x", feriados: ["2026-11-16"] })
  })
})
