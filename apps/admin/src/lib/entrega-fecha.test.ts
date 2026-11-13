import { describe, it, expect } from "vitest"
import casos from "./__fixtures__/envio-zona-casos.json"
import { fechaEntrega } from "./entrega-fecha"

describe("fechaEntrega (fixture compartido con el Shop)", () => {
  for (const c of casos.fechas.casos) {
    it(c.caso, () => {
      const horario = {
        ...casos.fechas.horario,
        ...("dias" in c ? { dias: c.dias as number[] } : {}),
        ...("margenMin" in c ? { margenMin: c.margenMin as number } : {}),
        ...("feriados" in c ? { feriados: c.feriados as string[] } : {}),
      }
      expect(fechaEntrega(new Date(c.instante), horario)).toEqual(c.esperado)
    })
  }

  it("sin días operativos falla en vez de buscar para siempre", () => {
    expect(() => fechaEntrega(new Date("2026-11-10T11:30:00Z"), { dias: [], horaCorte: "09:00", margenMin: 0 })).toThrow()
  })
  it("hora de corte inválida falla", () => {
    expect(() => fechaEntrega(new Date("2026-11-10T11:30:00Z"), { dias: [1], horaCorte: "25:00", margenMin: 0 })).toThrow()
  })
})
