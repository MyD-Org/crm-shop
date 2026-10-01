import { describe, it, expect } from "vitest"
import {
  MSG_DESACTIVAR_PREDETERMINADA,
  MSG_RANGO,
  MSG_SUCURSALES,
  validarCuentaBancaria,
} from "@/lib/cuentas-bancarias-shop-validacion"

// Datos ficticios: CBU/CUIT inventados, dominios .example.
const CBU = "0000000000000000000001"
const base = { alias: "tienda.pagos", cbu: CBU, todasLasSucursales: true }

describe("validarCuentaBancaria", () => {
  it("aplica los defaults: todas las sucursales, sin límites, activa, orden 0", () => {
    expect(validarCuentaBancaria(base)).toEqual({
      ok: true,
      valor: {
        alias: "tienda.pagos",
        cbu: CBU,
        banco: "",
        titular: "",
        cuit: "",
        todasLasSucursales: true,
        sucursalSlugs: [],
        montoMin: null,
        montoMax: null,
        activa: true,
        predeterminada: false,
        orden: 0,
      },
    })
  })

  it("exige alias y CBU de 22 dígitos", () => {
    expect(validarCuentaBancaria({ ...base, alias: "  " })).toMatchObject({ ok: false, campo: "alias" })
    expect(validarCuentaBancaria({ ...base, cbu: "123" })).toMatchObject({ ok: false, campo: "cbu" })
    expect(validarCuentaBancaria({ ...base, cbu: "00000000000000000000a1" })).toMatchObject({ ok: false, campo: "cbu" })
    expect(validarCuentaBancaria({ ...base, cbu: ` ${CBU} ` })).toMatchObject({ ok: true })
  })

  it("el CUIT es opcional pero, si viene, de 11 dígitos (acepta guiones)", () => {
    expect(validarCuentaBancaria({ ...base, cuit: "20-00000000-1" })).toMatchObject({ ok: true, valor: { cuit: "20000000001" } })
    expect(validarCuentaBancaria({ ...base, cuit: "123" })).toMatchObject({ ok: false, campo: "cuit" })
  })

  it("rechaza body que no es objeto", () => {
    expect(validarCuentaBancaria(null)).toMatchObject({ ok: false, campo: "body" })
    expect(validarCuentaBancaria([])).toMatchObject({ ok: false, campo: "body" })
  })

  describe("sucursales", () => {
    it("ninguna de las dos opciones se rechaza", () => {
      expect(validarCuentaBancaria({ ...base, todasLasSucursales: false, sucursalSlugs: [] })).toEqual({
        ok: false,
        campo: "sucursalSlugs",
        error: MSG_SUCURSALES,
      })
      expect(MSG_SUCURSALES).toBe("Seleccione 'Todas las sucursales' o al menos una sucursal.")
    })

    it("sin todasLasSucursales explícito no se asume nada", () => {
      expect(validarCuentaBancaria({ alias: "a", cbu: CBU })).toMatchObject({ ok: false, campo: "sucursalSlugs" })
    })

    it("elegir sucursales: normaliza, descarta repetidos y acepta varias", () => {
      expect(validarCuentaBancaria({ ...base, todasLasSucursales: false, sucursalSlugs: ["igz", " mdp ", "igz"] })).toMatchObject({
        ok: true,
        valor: { todasLasSucursales: false, sucursalSlugs: ["igz", "mdp"] },
      })
    })

    it("todas = true limpia la lista", () => {
      expect(validarCuentaBancaria({ ...base, todasLasSucursales: true, sucursalSlugs: ["igz"] })).toMatchObject({
        ok: true,
        valor: { todasLasSucursales: true, sucursalSlugs: [] },
      })
    })

    it("valida tipos", () => {
      expect(validarCuentaBancaria({ ...base, todasLasSucursales: "si" })).toMatchObject({ ok: false, campo: "todasLasSucursales" })
      expect(validarCuentaBancaria({ ...base, todasLasSucursales: false, sucursalSlugs: "igz" })).toMatchObject({ ok: false, campo: "sucursalSlugs" })
      expect(validarCuentaBancaria({ ...base, todasLasSucursales: false, sucursalSlugs: [1] })).toMatchObject({ ok: false, campo: "sucursalSlugs" })
    })
  })

  describe("rango de montos", () => {
    it("monto mínimo mayor que el máximo se rechaza", () => {
      expect(validarCuentaBancaria({ ...base, montoMin: 1000, montoMax: 500 })).toEqual({
        ok: false,
        campo: "montoMin",
        error: MSG_RANGO,
      })
      expect(MSG_RANGO).toBe("El monto mínimo no puede superar al máximo. Revíselo e inténtelo nuevamente.")
    })

    it("mínimo igual al máximo es válido (inclusivo)", () => {
      expect(validarCuentaBancaria({ ...base, montoMin: 1000, montoMax: 1000 })).toMatchObject({ ok: true })
    })

    it("un solo límite es válido; vacío o null = sin límite", () => {
      expect(validarCuentaBancaria({ ...base, montoMin: 100000 })).toMatchObject({ ok: true, valor: { montoMin: 100000, montoMax: null } })
      expect(validarCuentaBancaria({ ...base, montoMin: "", montoMax: null })).toMatchObject({ ok: true, valor: { montoMin: null, montoMax: null } })
      expect(validarCuentaBancaria({ ...base, montoMax: "500000" })).toMatchObject({ ok: true, valor: { montoMax: 500000 } })
    })

    it("rechaza negativos, máximo cero y valores no numéricos", () => {
      expect(validarCuentaBancaria({ ...base, montoMin: -1 })).toMatchObject({ ok: false, campo: "montoMin" })
      expect(validarCuentaBancaria({ ...base, montoMax: 0 })).toMatchObject({ ok: false, campo: "montoMax" })
      expect(validarCuentaBancaria({ ...base, montoMax: "abc" })).toMatchObject({ ok: false, campo: "montoMax" })
      expect(validarCuentaBancaria({ ...base, montoMin: 0 })).toMatchObject({ ok: true })
    })

    it("admite hasta dos decimales", () => {
      expect(validarCuentaBancaria({ ...base, montoMax: 10.505 })).toMatchObject({ ok: false, campo: "montoMax" })
      expect(validarCuentaBancaria({ ...base, montoMax: "10,5" })).toMatchObject({ ok: true, valor: { montoMax: 10.5 } })
    })
  })

  describe("predeterminada", () => {
    it("una predeterminada inactiva se rechaza", () => {
      expect(validarCuentaBancaria({ ...base, predeterminada: true, activa: false })).toEqual({
        ok: false,
        campo: "activa",
        error: MSG_DESACTIVAR_PREDETERMINADA,
      })
      expect(MSG_DESACTIVAR_PREDETERMINADA).toBe("Elija otra cuenta predeterminada antes de desactivar esta.")
    })
    it("predeterminada activa es válida", () => {
      expect(validarCuentaBancaria({ ...base, predeterminada: true })).toMatchObject({ ok: true, valor: { predeterminada: true, activa: true } })
    })
  })

  it("valida el orden (entero >= 0)", () => {
    expect(validarCuentaBancaria({ ...base, orden: -1 })).toMatchObject({ ok: false, campo: "orden" })
    expect(validarCuentaBancaria({ ...base, orden: "3" })).toMatchObject({ ok: true, valor: { orden: 3 } })
  })
})
