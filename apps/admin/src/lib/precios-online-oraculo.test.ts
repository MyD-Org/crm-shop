import { describe, it, expect } from "vitest"
import {
  calcularOraculo,
  coefCanonico,
  precioNeto,
  type CategoriaOraculo,
  type ListaOraculo,
  type OverrideOraculo,
} from "./precios-online-oraculo"

// Matriz de casos del cálculo de precios online (B.3). Datos inventados ("Lista A", "marca x").
// La MISMA matriz la ejecuta el test de integración contra la función SQL.

const CATEGORIAS: CategoriaOraculo[] = [
  { id: "cat-raiz", parentId: null, nivel: 1 },
  { id: "cat-hija", parentId: "cat-raiz", nivel: 2 },
  { id: "cat-nieta", parentId: "cat-hija", nivel: 3 },
  { id: "cat-otra-raiz", parentId: null, nivel: 1 },
  { id: "cat-otra-hija", parentId: "cat-otra-raiz", nivel: 2 },
]

const lista = (coeficiente: string, overrides: OverrideOraculo[] = [], activa = true): ListaOraculo => ({
  id: "lista-a",
  coeficiente,
  activa,
  overrides,
})
const ovMarca = (marca: string, coeficiente: string): OverrideOraculo => ({ tipo: "marca", marca, coeficiente })
const ovCat = (categoriaId: string, coeficiente: string): OverrideOraculo => ({
  tipo: "categoria",
  categoriaId,
  coeficiente,
})

const calc = (
  p: { costo: string | null; marca?: string | null; categorias?: string[] },
  l: ListaOraculo,
) => calcularOraculo({ costo: p.costo, marca: p.marca ?? null, categorias: p.categorias ?? [] }, [l], CATEGORIAS)[0]

describe("redondeo half-up sobre el neto", () => {
  it("33,33 x 1,25 = 41,6625 => 41,66", () => expect(precioNeto("33.33", "1.25")).toBe("41.66"))
  it("0,02 x 1,25 = 0,025 => 0,03", () => expect(precioNeto("0.02", "1.25")).toBe("0.03"))
  it("100 x 1,6 = 160,00", () => expect(precioNeto("100", "1.6")).toBe("160.00"))
  it("no redondea a pesos enteros", () => expect(precioNeto("10.10", "1.5")).toBe("15.15"))
  it("costo con 4 decimales", () => expect(precioNeto("10.3333", "1.5")).toBe("15.50"))
  it("coeficiente canónico", () => expect(coefCanonico("1.5")).toBe("1.5000"))
})

describe("precedencia del coeficiente", () => {
  it("general", () => {
    expect(calc({ costo: "100" }, lista("1.6"))).toMatchObject({ coef: "1.6000", origen: "general", precio: "160.00" })
  })
  it("categoría", () => {
    const r = calc({ costo: "100", categorias: ["cat-raiz"] }, lista("1.6", [ovCat("cat-raiz", "1.3")]))
    expect(r).toMatchObject({ coef: "1.3000", origen: "categoria:cat-raiz", precio: "130.00" })
  })
  it("hereda del ancestro más cercano", () => {
    const l = lista("1.6", [ovCat("cat-raiz", "1.4"), ovCat("cat-hija", "1.3")])
    expect(calc({ costo: "100", categorias: ["cat-nieta"] }, l)).toMatchObject({ origen: "categoria:cat-hija", coef: "1.3000" })
  })
  it("el override propio de la subcategoría gana al del padre", () => {
    const l = lista("1.6", [ovCat("cat-hija", "1.3"), ovCat("cat-nieta", "1.2")])
    expect(calc({ costo: "100", categorias: ["cat-nieta"] }, l)).toMatchObject({ origen: "categoria:cat-nieta", coef: "1.2000" })
  })
  it("marca gana sobre categoría", () => {
    const l = lista("1.6", [ovMarca("marca x", "1.5"), ovCat("cat-raiz", "1.3")])
    expect(calc({ costo: "100", marca: "marca x", categorias: ["cat-raiz"] }, l)).toMatchObject({
      origen: "marca:marca x",
      coef: "1.5000",
    })
  })
  it("marca vacía no aplica override de marca", () => {
    expect(calc({ costo: "100", marca: null }, lista("1.6", [ovMarca("marca x", "1.5")]))).toMatchObject({ origen: "general" })
  })
  it("sin categoría propia solo marca o general", () => {
    const l = lista("1.6", [ovCat("cat-raiz", "1.3")])
    expect(calc({ costo: "100", categorias: [] }, l)).toMatchObject({ origen: "general" })
  })
  it("categoría de otra rama no aplica", () => {
    const l = lista("1.6", [ovCat("cat-otra-raiz", "1.3")])
    expect(calc({ costo: "100", categorias: ["cat-nieta"] }, l)).toMatchObject({ origen: "general" })
  })
})

describe("varias categorías (DC1)", () => {
  it("gana la más profunda", () => {
    const l = lista("1.6", [ovCat("cat-hija", "1.2"), ovCat("cat-nieta", "1.35")])
    expect(calc({ costo: "100", categorias: ["cat-hija", "cat-nieta"] }, l)).toMatchObject({ origen: "categoria:cat-nieta", coef: "1.3500" })
  })
  it("empate de profundidad: mayor coeficiente", () => {
    const l = lista("1.6", [ovCat("cat-hija", "1.2"), ovCat("cat-otra-hija", "1.35")])
    expect(calc({ costo: "100", categorias: ["cat-hija", "cat-otra-hija"] }, l)).toMatchObject({
      origen: "categoria:cat-otra-hija",
      coef: "1.3500",
    })
  })
})

describe("sin precio y listas inactivas", () => {
  it("costo nulo => sin precio", () => expect(calc({ costo: null }, lista("1.6")).precio).toBeNull())
  it("costo 0 => sin precio (nunca 0)", () => expect(calc({ costo: "0" }, lista("1.6")).precio).toBeNull())
  it("lista inactiva no emite", () => {
    expect(calcularOraculo({ costo: "100", marca: null, categorias: [] }, [lista("1.6", [], false)], CATEGORIAS)).toEqual([])
  })
})
