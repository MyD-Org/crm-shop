import { describe, expect, it } from "vitest"
import { agruparPorDia, rangoSemana } from "./semana"
import type { PiezaDto } from "./tipos"

describe("semana del calendario", () => {
  it("devuelve de lunes a domingo en hora Argentina", () => {
    const r = rangoSemana("2026-10-15")
    expect(r.dias).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"])
    expect(r.desde.toISOString()).toBe("2026-10-12T03:00:00.000Z")
    expect(r.hasta.toISOString()).toBe("2026-10-19T03:00:00.000Z")
  })

  it("sin fecha usa la semana de hoy", () => {
    expect(rangoSemana(undefined, new Date("2026-10-11T15:00:00Z")).dias[0]).toBe("2026-10-05")
  })

  it("una fecha inválida cae a la semana de hoy", () => {
    expect(rangoSemana("cualquier-cosa", new Date("2026-10-14T15:00:00Z")).dias[0]).toBe("2026-10-12")
  })

  it("agrupa por el día local de programada_para", () => {
    const p = (id: string, programadaPara: string | null) => ({ id, programadaPara }) as PiezaDto
    const g = agruparPorDia([p("a", "2026-10-13T02:30:00Z"), p("b", "2026-10-13T15:00:00Z"), p("c", null)], ["2026-10-12", "2026-10-13"])
    expect(g["2026-10-12"].map((x) => x.id)).toEqual(["a"])
    expect(g["2026-10-13"].map((x) => x.id)).toEqual(["b"])
    expect(g["sin_fecha"].map((x) => x.id)).toEqual(["c"])
  })
})
