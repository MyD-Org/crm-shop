import { describe, it, expect } from "vitest"
import { resumenMonto, resumenSucursales } from "@/lib/cuentas-bancarias-shop-resumen"

describe("resumenSucursales", () => {
  it("todas las sucursales", () => {
    expect(resumenSucursales({ todasLasSucursales: true, sucursalSlugs: [] })).toBe("Todas las sucursales")
  })
  it("lista las elegidas", () => {
    expect(resumenSucursales({ todasLasSucursales: false, sucursalSlugs: ["igz", "mdp"] })).toBe("Sucursales: igz, mdp")
  })
})

describe("resumenMonto", () => {
  it("sin límites", () => {
    expect(resumenMonto({ montoMin: null, montoMax: null })).toBe("Cualquier monto")
  })
  it("solo máximo", () => {
    expect(resumenMonto({ montoMin: null, montoMax: 500000 })).toBe("Monto: hasta 500.000")
    expect(resumenMonto({ montoMin: 0, montoMax: 500000 })).toBe("Monto: hasta 500.000")
  })
  it("solo mínimo", () => {
    expect(resumenMonto({ montoMin: 100000, montoMax: null })).toBe("Monto: desde 100.000")
  })
  it("rango, con decimales cuando los hay", () => {
    expect(resumenMonto({ montoMin: 1000, montoMax: 2000.5 })).toBe("Monto: de 1.000 a 2.000,50")
  })
})
