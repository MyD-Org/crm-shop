import { describe, expect, it } from "vitest"
import { prng } from "./__fixtures__/prng"
import { calcularTotalBillCentavos } from "./mock-alegra-compras"
import {
  aPesos,
  ErrorCompras,
  ivaBpDePorcentaje,
  MODELO_IVA,
  representarNetoE5,
  subtotalCentavos,
  subtotalExactoE5,
  totalDeLineasCentavos,
  validarCantidadMilesimas,
  validarCostoCentavos,
} from "./compras-dinero"

describe("compras-dinero", () => {
  it("el modelo de IVA es el que midió el sondeo de Alegra", () => {
    expect(MODELO_IVA).toBe("exacto_redondeo_final")
  })

  it("subtotal exacto: precio por cantidad sin redondear (cienmilésimas de peso)", () => {
    // 100,00 x 4 = 400,00 pesos = 40_000_000 cienmilésimas
    expect(subtotalExactoE5(10_000, 4_000)).toBe(BigInt(40_000_000))
    // 33,33 x 0,333 = 11,09889 pesos
    expect(subtotalExactoE5(3_333, 333)).toBe(BigInt(1_109_889))
  })

  it("subtotal en centavos: half-up del exacto", () => {
    expect(subtotalCentavos(10_000, 4_000)).toBe(40_000)
    expect(subtotalCentavos(3_333, 333)).toBe(1_110) // 11,09889 -> 11,10
    expect(subtotalCentavos(1, 500)).toBe(1) // 0,005 -> 0,01 (half-up)
    expect(subtotalCentavos(1, 499)).toBe(0)
  })

  it("iva en puntos básicos desde el porcentaje", () => {
    expect(ivaBpDePorcentaje(21)).toBe(2100)
    expect(ivaBpDePorcentaje(10.5)).toBe(1050)
    expect(ivaBpDePorcentaje(0)).toBe(0)
    expect(ivaBpDePorcentaje(27)).toBe(2700)
  })

  it("total de líneas: IVA exacto y un solo redondeo final (3 x 10,01 al 21 % = 36,34)", () => {
    const l = { precioCentavos: 1001, cantidadMilesimas: 1000, taxIds: ["1"] }
    expect(totalDeLineasCentavos([l, l, l], { "1": 2100 })).toBe(3634)
  })

  it("caso fraccionario del sondeo: 0,495 x 1,00 al 21 % = 0,59895 -> 0,60", () => {
    expect(
      totalDeLineasCentavos([{ precioCentavos: 100, cantidadMilesimas: 495, taxIds: ["1"] }], { "1": 2100 }),
    ).toBe(60)
  })

  it("sin impuesto conocido no suma IVA", () => {
    expect(
      totalDeLineasCentavos([{ precioCentavos: 1000, cantidadMilesimas: 1000, taxIds: [] }], {}),
    ).toBe(1000)
  })

  it("coincide con el cálculo del mock de Alegra (2000 casos de semilla fija)", () => {
    const r = prng(20261115)
    const tax = ["1", "3", "4"]
    const bp = { "1": 2100, "3": 1050, "4": 0 }
    for (let i = 0; i < 2000; i++) {
      const n = 1 + Math.floor(r() * 5)
      const lineas = Array.from({ length: n }, () => ({
        precioCentavos: Math.floor(r() * 200_000),
        cantidadMilesimas: 1 + Math.floor(r() * 50_000),
        taxIds: [tax[Math.floor(r() * 3)]],
      }))
      expect(totalDeLineasCentavos(lineas, bp)).toBe(calcularTotalBillCentavos(lineas))
    }
  })

  it("aPesos convierte centavos a pesos", () => {
    expect(aPesos(123_456)).toBe(1234.56)
    expect(aPesos(0)).toBe(0)
  })

  it("representarNetoE5: múltiplo de centavo -> precio x 1; si no, 1 centavo x cantidad fraccionaria", () => {
    expect(representarNetoE5(BigInt(60_000_000))).toEqual({ precioCentavos: 60_000, cantidadMilesimas: 1000 })
    const f = representarNetoE5(BigInt(1_109_889))
    expect(f).toEqual({ precioCentavos: 1, cantidadMilesimas: 1_109_889 })
    expect(BigInt(f.precioCentavos) * BigInt(f.cantidadMilesimas)).toBe(BigInt(1_109_889))
  })

  it("representarNetoE5 rechaza no positivos y fuera de rango", () => {
    expect(() => representarNetoE5(BigInt(0))).toThrow(ErrorCompras)
    expect(() => representarNetoE5(BigInt(-5))).toThrow(ErrorCompras)
    expect(() => representarNetoE5(BigInt("9007199254740993"))).toThrow(ErrorCompras)
  })

  it("validaciones en usted: costo y cantidad", () => {
    expect(() => validarCostoCentavos(-1)).toThrow(/costo/i)
    expect(() => validarCostoCentavos(1.5)).toThrow(ErrorCompras)
    expect(() => validarCostoCentavos(Number.NaN)).toThrow(ErrorCompras)
    expect(validarCostoCentavos(0)).toBe(0)
    expect(() => validarCantidadMilesimas(0)).toThrow(/cantidad/i)
    expect(() => validarCantidadMilesimas(-3)).toThrow(ErrorCompras)
    expect(() => validarCantidadMilesimas(0.5)).toThrow(ErrorCompras)
    expect(validarCantidadMilesimas(1)).toBe(1)
  })
})
