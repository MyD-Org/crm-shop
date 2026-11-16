import { describe, expect, it } from "vitest"
import { accionesDeCompra, AVISO_COSTO_PROMEDIO, estadoCompra, formatoFecha, formatoPesos } from "./compras-formato"

describe("compras-formato", () => {
  it("da formato de pesos argentinos desde centavos", () => {
    expect(formatoPesos(124_000).replace(/\s/g, " ")).toMatch(/1\.240,00/)
    expect(formatoPesos(5)).toMatch(/0,05/)
  })

  it("da formato a la fecha sin corrimiento de huso horario", () => {
    expect(formatoFecha("2026-11-01")).toBe("01/11/2026")
    expect(formatoFecha("2026-11-01T00:00:00Z")).toBe("01/11/2026")
  })

  it("cada estado tiene etiqueta en español y tono", () => {
    expect(estadoCompra("pendiente").etiqueta).toBe("Pendiente de recepción")
    expect(estadoCompra("anulada_en_alegra").tono).toBe("danger")
    expect(estadoCompra("inventado").etiqueta).toBe("inventado")
  })

  it("sólo se edita y anula una compra pendiente sin recepciones", () => {
    expect(accionesDeCompra("pendiente", false)).toEqual({ editar: true, anular: true })
    expect(accionesDeCompra("pendiente", true)).toEqual({ editar: false, anular: false })
    for (const e of ["creando", "parcial", "completa", "cerrada_faltante", "anulada", "anulada_en_alegra"]) {
      expect(accionesDeCompra(e, false)).toEqual({ editar: false, anular: false })
    }
  })

  it("el aviso del costo promedio está en usted", () => {
    expect(AVISO_COSTO_PROMEDIO).toContain("lo actualiza Alegra")
    expect(AVISO_COSTO_PROMEDIO).not.toMatch(/\b(tu|tus|vos)\b/i)
  })
})
