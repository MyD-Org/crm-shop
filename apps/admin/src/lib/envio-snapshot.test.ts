import { describe, it, expect } from "vitest"
import { horarioDeDetalle } from "./envio-snapshot"
import { fechaEntrega } from "./entrega-fecha"

describe("horarioDeDetalle (lectura del snapshot que escribe el Shop)", () => {
  const h = { dias: [1, 2, 3, 4, 5], horaCorte: "09:00", margenMin: 0 }

  it("un pedido anterior, sin feriados, se lee como siempre", () => {
    expect(horarioDeDetalle({ horario: { ...h, tz: "America/Argentina/Buenos_Aires" } })).toEqual(h)
  })
  it("lee los feriados congelados: sólo fechas válidas, ordenadas y sin repetir", () => {
    expect(horarioDeDetalle({ horario: { ...h, feriados: ["2026-12-08", "2026-11-16", "2026-11-16", "2026-02-30", "x", 4] } })).toEqual({
      ...h,
      feriados: ["2026-11-16", "2026-12-08"],
    })
    expect(horarioDeDetalle({ horario: { ...h, feriados: "no es lista" } })).toEqual(h)
  })
  it("sigue rechazando un horario no confiable", () => {
    expect(horarioDeDetalle({ horario: { dias: [], horaCorte: "09:00", margenMin: 0 } })).toBeNull()
    expect(horarioDeDetalle(null)).toBeNull()
  })
  it("la fecha real que fija el CRM usa los feriados del pedido (lunes feriado: viernes tarde llega el martes); el viejo, el lunes", () => {
    const viernesTarde = new Date("2026-11-13T18:00:00Z")
    expect(fechaEntrega(viernesTarde, horarioDeDetalle({ horario: { ...h, feriados: ["2026-11-16"] } })!).fecha).toBe("2026-11-17")
    expect(fechaEntrega(viernesTarde, horarioDeDetalle({ horario: h })!).fecha).toBe("2026-11-16")
  })
  it("feriado seguido de domingo (sábado operativo): sábado y lunes feriados, llega el martes", () => {
    const horario = horarioDeDetalle({ horario: { ...h, dias: [1, 2, 3, 4, 5, 6], feriados: ["2026-11-14", "2026-11-16"] } })!
    expect(fechaEntrega(new Date("2026-11-13T18:00:00Z"), horario).fecha).toBe("2026-11-17")
  })
})
