import { describe, it, expect } from "vitest"
import {
  MSG_OPCIONES_INVALIDAS,
  MSG_SIN_OPCIONES,
  errorDeOpcionesResultantes,
  opcionesAplicables,
  validarOpciones,
} from "@/lib/medios-pago-shop-opciones"

describe("validarOpciones", () => {
  it("acepta las conocidas y las devuelve en el orden canónico", () => {
    expect(validarOpciones(["cuenta_mp", "credito"])).toEqual({ ok: true, opciones: ["credito", "cuenta_mp"] })
    expect(validarOpciones([])).toEqual({ ok: true, opciones: [] })
  })

  it("rechaza valores desconocidos, repetidos o algo que no es un array", () => {
    for (const v of [["efectivo"], ["credito", "credito"], "credito", null, { credito: true }, [1]]) {
      expect(validarOpciones(v), JSON.stringify(v)).toEqual({ ok: false, error: MSG_OPCIONES_INVALIDAS })
    }
  })
})

describe("opcionesAplicables", () => {
  it("Mercado Pago cobra las tres", () => {
    expect(opcionesAplicables("mercadopago", ["credito", "debito", "cuenta_mp"])).toEqual(["credito", "debito", "cuenta_mp"])
  })

  it("Payway ignora la cuenta de Mercado Pago", () => {
    expect(opcionesAplicables("payway", ["credito", "debito", "cuenta_mp"])).toEqual(["credito", "debito"])
    expect(opcionesAplicables("payway", ["cuenta_mp"])).toEqual([])
  })
})

describe("errorDeOpcionesResultantes", () => {
  const mp = { slug: "mercadopago", activo: true, cobroOnline: true, opcionesCobro: ["debito"] }

  it("activo con cobro en línea y al menos una aplicable: válido", () => {
    expect(errorDeOpcionesResultantes(mp)).toBeNull()
  })

  it("activo con cobro en línea y ninguna aplicable: error en usted", () => {
    expect(errorDeOpcionesResultantes({ ...mp, opcionesCobro: [] })).toBe(MSG_SIN_OPCIONES)
    expect(errorDeOpcionesResultantes({ ...mp, slug: "payway", opcionesCobro: ["cuenta_mp"] })).toBe(MSG_SIN_OPCIONES)
  })

  it("inactivo o sin cobro en línea: no se exigen opciones", () => {
    expect(errorDeOpcionesResultantes({ ...mp, activo: false, opcionesCobro: [] })).toBeNull()
    expect(errorDeOpcionesResultantes({ ...mp, slug: "transferencia", cobroOnline: false, opcionesCobro: [] })).toBeNull()
  })
})
