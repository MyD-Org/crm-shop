import { describe, it, expect } from "vitest"
import { MSG_ENTERO, REGLAS_VENTA_DEFAULT, validarReglasVenta } from "@/lib/reglas-venta-validacion"

describe("validarReglasVenta", () => {
  it("los defaults son los del design", () => {
    expect(REGLAS_VENTA_DEFAULT).toEqual({
      respaldoEnvio: true,
      retiroSinStock: "ofrecer",
      trasladoDias: 7,
      reservaDias: 7,
      avisoSinContactarHoras: 24,
      contactoHorasHabiles: 24,
      mensajeConfirmacion: "",
    })
  })

  it("mensaje de confirmación: se recorta, acepta {plazo} y {whatsapp} y rechaza otras variables o excesos", () => {
    expect(validarReglasVenta({ mensajeConfirmacion: "  Le escribiremos en {plazo}. {whatsapp}  " })).toEqual({
      ok: true,
      cambios: { mensajeConfirmacion: "Le escribiremos en {plazo}. {whatsapp}" },
    })
    expect(validarReglasVenta({ mensajeConfirmacion: "" })).toEqual({ ok: true, cambios: { mensajeConfirmacion: "" } })
    expect(validarReglasVenta({ mensajeConfirmacion: "Hola {nombre}" })).toMatchObject({ ok: false, campo: "mensajeConfirmacion" })
    expect(validarReglasVenta({ mensajeConfirmacion: "a".repeat(1001) })).toMatchObject({ ok: false, campo: "mensajeConfirmacion" })
    expect(validarReglasVenta({ mensajeConfirmacion: 5 })).toMatchObject({ ok: false, campo: "mensajeConfirmacion" })
  })

  it("acepta un cambio parcial y devuelve solo lo enviado", () => {
    expect(validarReglasVenta({ reservaDias: 0 })).toEqual({ ok: true, cambios: { reservaDias: 0 } })
  })

  it("acepta enteros como texto numérico", () => {
    expect(validarReglasVenta({ trasladoDias: " 3 ", avisoSinContactarHoras: "48" })).toEqual({
      ok: true,
      cambios: { trasladoDias: 3, avisoSinContactarHoras: 48 },
    })
  })

  it.each([-1, 1.5, "", "abc", "-2", null, true])("rechaza %j como entero (en usted)", (valor) => {
    const r = validarReglasVenta({ trasladoDias: valor })
    expect(r).toEqual({ ok: false, campo: "trasladoDias", error: MSG_ENTERO })
  })

  it("rechaza valores por encima del tope", () => {
    expect(validarReglasVenta({ reservaDias: 366 })).toMatchObject({ ok: false, campo: "reservaDias" })
    expect(validarReglasVenta({ contactoHorasHabiles: 721 })).toMatchObject({ ok: false, campo: "contactoHorasHabiles" })
  })

  it("valida el retiro sin stock y el respaldo de envío", () => {
    expect(validarReglasVenta({ retiroSinStock: "bloquear", respaldoEnvio: false })).toEqual({
      ok: true,
      cambios: { retiroSinStock: "bloquear", respaldoEnvio: false },
    })
    expect(validarReglasVenta({ retiroSinStock: "otro" })).toMatchObject({ ok: false, campo: "retiroSinStock" })
    expect(validarReglasVenta({ respaldoEnvio: "si" })).toMatchObject({ ok: false, campo: "respaldoEnvio" })
  })

  it("rechaza un body que no es objeto", () => {
    expect(validarReglasVenta(null)).toMatchObject({ ok: false, campo: "body" })
    expect(validarReglasVenta([])).toMatchObject({ ok: false, campo: "body" })
  })

  it("los mensajes no usan voseo ni tuteo", () => {
    const r = validarReglasVenta({ trasladoDias: -1 })
    expect(r.ok === false && /\b(ingresá|tu|tus|vos)\b/i.test(r.error)).toBe(false)
  })
})
