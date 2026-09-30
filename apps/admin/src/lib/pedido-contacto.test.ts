import { describe, it, expect } from "vitest"
import { estaSinContactar, horasDesde, textoSinContactar } from "@/lib/pedido-contacto"

const AHORA = new Date("2026-09-30T12:00:00Z")
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 3_600_000)
const pedido = (h: number, extra: Partial<{ estado: string; contactadoEn: Date | null }> = {}) => ({
  estado: "pendiente",
  creadoEn: haceHoras(h),
  contactadoEn: null,
  ...extra,
})

describe("estaSinContactar", () => {
  it("pendiente de 25 h sin contactar con umbral 24 → sí", () => {
    expect(estaSinContactar(pedido(25), 24, AHORA)).toBe(true)
  })

  it("pendiente de 23 h → todavía no", () => {
    expect(estaSinContactar(pedido(23), 24, AHORA)).toBe(false)
  })

  it("justo en el umbral no cuenta (es 'más de N horas')", () => {
    expect(estaSinContactar(pedido(24), 24, AHORA)).toBe(false)
  })

  it("si ya se contactó, no", () => {
    expect(estaSinContactar(pedido(48, { contactadoEn: haceHoras(1) }), 24, AHORA)).toBe(false)
  })

  it("solo los pendientes: confirmado, cancelado o entregado no", () => {
    for (const estado of ["confirmado", "preparacion", "en_camino", "entregado", "cancelado"]) {
      expect(estaSinContactar(pedido(48, { estado }), 24, AHORA), estado).toBe(false)
    }
  })

  it("umbral 0 apaga el aviso", () => {
    expect(estaSinContactar(pedido(500), 0, AHORA)).toBe(false)
  })
})

describe("textoSinContactar / horasDesde", () => {
  it("horas enteras y nunca negativas", () => {
    expect(horasDesde(haceHoras(25.9), AHORA)).toBe(25)
    expect(horasDesde(new Date(AHORA.getTime() + 5000), AHORA)).toBe(0)
  })

  it("muestra horas hasta 48 h y días después", () => {
    expect(textoSinContactar(haceHoras(25), AHORA)).toBe("Sin contactar hace 25 h")
    expect(textoSinContactar(haceHoras(72), AHORA)).toBe("Sin contactar hace 3 días")
  })
})
