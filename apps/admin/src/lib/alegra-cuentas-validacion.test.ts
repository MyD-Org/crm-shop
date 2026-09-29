import { describe, expect, it } from "vitest"
import { cuitValido, formatearCuit, slugDeCuenta, soloDigitos, validarCuentaEntrada } from "./alegra-cuentas-validacion"

// CUIT ficticio con dígito verificador correcto (calculado, no es de nadie).
const CUIT_OK = "20111111112"

describe("cuitValido", () => {
  it("acepta un CUIT con dígito verificador correcto", () => {
    expect(cuitValido(CUIT_OK)).toBe(true)
  })
  it("rechaza dígito verificador incorrecto, largo distinto y no numéricos", () => {
    expect(cuitValido("20111111113")).toBe(false)
    expect(cuitValido("2011111111")).toBe(false)
    expect(cuitValido("20-11111111-2")).toBe(false)
    expect(cuitValido("abcdefghijk")).toBe(false)
  })
  it("formatea y limpia", () => {
    expect(formatearCuit(CUIT_OK)).toBe("20-11111111-2")
    expect(soloDigitos("20-11111111-2")).toBe(CUIT_OK)
    expect(formatearCuit("123")).toBe("123")
  })
})

describe("validarCuentaEntrada", () => {
  it("modo ninguna no exige nada y descarta el resto", () => {
    const r = validarCuentaEntrada({ modo: "ninguna", email: "x", cuit: "1" }, { esAlta: true })
    expect(r).toEqual({ ok: true, valor: { modo: "ninguna" } })
  })
  it("modo desconocido o cuerpo inválido", () => {
    expect(validarCuentaEntrada({ modo: "otra" }, { esAlta: true })).toMatchObject({ ok: false, campo: "modo" })
    expect(validarCuentaEntrada(null, { esAlta: true })).toMatchObject({ ok: false, campo: "body" })
    expect(validarCuentaEntrada([], { esAlta: true })).toMatchObject({ ok: false, campo: "body" })
  })
  it("modo principal acepta CUIT con guiones y lo normaliza", () => {
    const r = validarCuentaEntrada({ modo: "principal", cuit: "20-11111111-2" }, { esAlta: true })
    expect(r).toEqual({ ok: true, valor: { modo: "principal", cuit: CUIT_OK } })
  })
  it("CUIT inválido se rechaza en usted; vacío se permite (borra)", () => {
    expect(validarCuentaEntrada({ modo: "principal", cuit: "20111111113" }, { esAlta: true })).toEqual({
      ok: false,
      campo: "cuit",
      error: "Ingrese un CUIT válido de 11 dígitos.",
    })
    expect(validarCuentaEntrada({ modo: "principal", cuit: "" }, { esAlta: true })).toMatchObject({ ok: true })
  })
  it("propia en alta exige correo y token", () => {
    expect(validarCuentaEntrada({ modo: "propia", token: "t" }, { esAlta: true })).toMatchObject({ ok: false, campo: "email" })
    expect(validarCuentaEntrada({ modo: "propia", email: "a@cliente.example" }, { esAlta: true })).toMatchObject({
      ok: false,
      campo: "token",
      error: "Ingrese el token de la cuenta de Alegra.",
    })
  })
  it("propia en edición deja el token vacío = conservar", () => {
    const r = validarCuentaEntrada({ modo: "propia", email: "a@cliente.example", token: "  " }, { esAlta: false })
    expect(r).toEqual({ ok: true, valor: { modo: "propia", email: "a@cliente.example" } })
  })
  it("correo inválido y tipos incorrectos", () => {
    expect(validarCuentaEntrada({ modo: "propia", email: "sin-arroba", token: "t" }, { esAlta: true })).toMatchObject({
      ok: false,
      campo: "email",
      error: "Ingrese un correo válido.",
    })
    expect(validarCuentaEntrada({ modo: "propia", email: "a@cliente.example", token: 5 }, { esAlta: true })).toMatchObject({
      ok: false,
      campo: "token",
    })
  })
  it("recorta espacios", () => {
    const r = validarCuentaEntrada({ modo: "propia", email: " a@cliente.example ", token: " tk " }, { esAlta: true })
    expect(r).toEqual({ ok: true, valor: { modo: "propia", email: "a@cliente.example", token: "tk" } })
  })
})

describe("slugDeCuenta", () => {
  it("recorta a 12 y no deja guiones en los bordes", () => {
    expect(slugDeCuenta("mdp")).toBe("mdp")
    expect(slugDeCuenta("mar-del-plata-centro")).toBe("mar-del-plat")
    expect(slugDeCuenta("mar-del-pla-x")).toBe("mar-del-pla")
  })
})
