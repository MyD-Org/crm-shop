import { describe, it, expect } from "vitest"
import type { PromocionDto } from "@/lib/cupones-repo"
import { ROTULO_ESTADO_PROMO, cuerpoPromocion, formDesdeDto, formVacioPromocion, textoBeneficio, type FormPromocion } from "./cupones-ui"

const MEDIOS = ["transferencia", "mercadopago", "a_coordinar"]

const form = (extra: Partial<FormPromocion> = {}): FormPromocion => ({
  ...formVacioPromocion(MEDIOS),
  nombre: " Bot Instagram ",
  tipo: "unicos",
  prefijo: "luz",
  pct: "10",
  inicioFecha: "2026-11-05",
  inicioHora: "00:00",
  finFecha: "2026-12-01",
  finHora: "23:59",
  venceDias: "7",
  ...extra,
})

describe("cuerpoPromocion", () => {
  it("convierte números y vacíos", () => {
    const c = cuerpoPromocion(form({ minimo: "", limite: "100" }), MEDIOS)
    expect(c).toMatchObject({ nombre: "Bot Instagram", pct: 10, minimo: null, limiteCanjes: 100, venceDiasDesdeEmision: 7, prefijo: "luz" })
    expect(cuerpoPromocion(form({ pct: "" }), MEDIOS).pct).toBeNull()
  })

  it("pasa fechas y horas a ISO -03:00", () => {
    const c = cuerpoPromocion(form(), MEDIOS)
    expect(c.inicio).toBe("2026-11-05T00:00:00-03:00")
    expect(c.fin).toBe("2026-12-01T23:59:00-03:00")
  })

  it("todos los medios o todas las formas tildados = null (todos)", () => {
    expect(cuerpoPromocion(form(), MEDIOS)).toMatchObject({ medios: null, formas: null })
    expect(cuerpoPromocion(form({ medios: ["transferencia"], formas: ["debito"] }), MEDIOS)).toMatchObject({
      medios: ["transferencia"],
      formas: ["debito"],
    })
  })

  it("genérica: manda el código y no el prefijo ni los días", () => {
    const c = cuerpoPromocion(form({ tipo: "generica", codigo: "APERTURA10" }), MEDIOS)
    expect(c).toMatchObject({ tipo: "generica", codigo: "APERTURA10", venceDiasDesdeEmision: null })
    expect(c.prefijo).toBeUndefined()
  })

  it("provincias: claves tildadas; ninguna = null (todas)", () => {
    expect(cuerpoPromocion(form({ envioGratis: true, provincias: ["buenosaires", "cordoba"] }), MEDIOS).provinciasEnvio).toEqual([
      "buenosaires",
      "cordoba",
    ])
    expect(cuerpoPromocion(form({ provincias: [] }), MEDIOS).provinciasEnvio).toBeNull()
  })
})

describe("formDesdeDto", () => {
  it("vuelve al formulario en hora de Argentina", () => {
    const dto = {
      ...cuerpoPromocion(form({ medios: ["transferencia"] }), MEDIOS),
      prefijo: "LUZ",
      inicio: "2026-11-05T03:00:00.000Z",
      fin: "2026-12-02T02:59:00.000Z",
      id: "p1",
      estado: "activa",
      activa: true,
      codigosEmitidos: 0,
      canjesUsados: 0,
      descuentoTotal: 0,
      tieneToken: false,
    } as PromocionDto
    const f = formDesdeDto(dto, MEDIOS)
    expect(f).toMatchObject({ inicioFecha: "2026-11-05", inicioHora: "00:00", finFecha: "2026-12-01", finHora: "23:59", pct: "10", medios: ["transferencia"] })
    expect(formDesdeDto({ ...dto, medios: null, formas: null }, MEDIOS)).toMatchObject({ medios: MEDIOS, formas: ["credito", "debito", "cuenta_mp"] })
  })
})

describe("textos", () => {
  it("textoBeneficio", () => {
    expect(textoBeneficio({ pct: 10, envioGratis: true })).toBe("10 % + envío gratis")
    expect(textoBeneficio({ pct: null, envioGratis: true })).toBe("Envío gratis")
    expect(textoBeneficio({ pct: 15, envioGratis: false })).toBe("15 %")
  })
  it("ROTULO_ESTADO_PROMO", () => {
    expect(ROTULO_ESTADO_PROMO.pausada.texto).toBe("Pausada")
    expect(ROTULO_ESTADO_PROMO.activa).toEqual({ texto: "Activa", tono: "success" })
  })
})
