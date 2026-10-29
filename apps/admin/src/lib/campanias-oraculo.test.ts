import { describe, expect, it } from "vitest"
import {
  calcularCampaniasOraculo,
  type CampaniaOraculo,
  type ProductoCampaniaOraculo,
} from "./campanias-oraculo"
import type { CategoriaOraculo } from "./precios-online-oraculo"

// Matriz de casos de la regla de campañas (spec 2026-10-28-campanias-precios-design.md). Datos inventados.

const AHORA = new Date("2026-11-28T12:00:00-03:00")
const h = (horas: number) => new Date(AHORA.getTime() + horas * 3_600_000)

const prod = (alegraId: string, extra: Partial<ProductoCampaniaOraculo> = {}): ProductoCampaniaOraculo => ({
  alegraId,
  grupoId: null,
  marca: null,
  categoriaId: null,
  ...extra,
})

const camp = (reglas: CampaniaOraculo["reglas"], extra: Partial<CampaniaOraculo> = {}): CampaniaOraculo => ({
  id: "c1",
  inicio: h(-24),
  fin: h(24),
  reglas,
  ...extra,
})

const CATS: CategoriaOraculo[] = [
  { id: "madre", parentId: null, nivel: 1 },
  { id: "hija", parentId: "madre", nivel: 2 },
  { id: "hermana", parentId: "madre", nivel: 2 },
  { id: "nieta", parentId: "hija", nivel: 3 },
]

function pctDe(r: ReturnType<typeof calcularCampaniasOraculo>, alegraId: string): number[] {
  return (r.get(alegraId) ?? []).map((e) => e.pct)
}

describe("calcularCampaniasOraculo", () => {
  it("regla de marca: alcanza a la marca normalizada", () => {
    const r = calcularCampaniasOraculo(
      [prod("P1", { marca: " ACME " }), prod("P2", { marca: "otra" })],
      [camp([{ id: "r1", tipo: "marca", marca: "acme", pct: 20 }])],
      CATS,
      AHORA,
    )
    expect(pctDe(r, "P1")).toEqual([20])
    expect(pctDe(r, "P2")).toEqual([])
  })

  it("producto al 0 % excluye de la regla de marca", () => {
    const r = calcularCampaniasOraculo(
      [prod("P1", { marca: "acme" }), prod("P2", { marca: "acme" })],
      [
        camp([
          { id: "r1", tipo: "marca", marca: "acme", pct: 20 },
          { id: "r2", tipo: "producto", alegraId: "P1", pct: 0 },
        ]),
      ],
      CATS,
      AHORA,
    )
    expect(pctDe(r, "P1")).toEqual([])
    expect(pctDe(r, "P2")).toEqual([20])
  })

  it("producto le gana a marca", () => {
    const r = calcularCampaniasOraculo(
      [prod("P1", { marca: "acme" })],
      [
        camp([
          { id: "r1", tipo: "marca", marca: "acme", pct: 20 },
          { id: "r2", tipo: "producto", alegraId: "P1", pct: 30, unidades: 5 },
        ]),
      ],
      CATS,
      AHORA,
    )
    expect(r.get("P1")).toEqual([{ campaniaId: "c1", reglaId: "r2", pct: 30, unidades: 5 }])
  })

  it("categoría más profunda gana; empate de nivel = mayor %", () => {
    const r = calcularCampaniasOraculo(
      [prod("P1", { categoriaId: "nieta" }), prod("P2", { categoriaId: "hermana" })],
      [
        camp([
          { id: "r1", tipo: "categoria", categoriaId: "madre", pct: 10 },
          { id: "r2", tipo: "categoria", categoriaId: "hija", pct: 15 },
        ]),
      ],
      CATS,
      AHORA,
    )
    expect(pctDe(r, "P1")).toEqual([15])
    expect(pctDe(r, "P2")).toEqual([10])
  })

  it("variante sin categoría propia toma la del ancla del modelo", () => {
    const r = calcularCampaniasOraculo(
      [prod("M", { grupoId: "M", categoriaId: "madre" }), prod("V2", { grupoId: "M" })],
      [camp([{ id: "r1", tipo: "categoria", categoriaId: "madre", pct: 10 }])],
      CATS,
      AHORA,
    )
    expect(pctDe(r, "V2")).toEqual([10])
    expect(pctDe(r, "M")).toEqual([10])
  })

  it("regla de producto sobre una variante alcanza a todo el modelo", () => {
    const r = calcularCampaniasOraculo(
      [prod("M", { grupoId: "M" }), prod("V1", { grupoId: "M" }), prod("V2", { grupoId: "M" }), prod("S")],
      [camp([{ id: "r1", tipo: "producto", alegraId: "V1", pct: 25 }])],
      CATS,
      AHORA,
    )
    expect(pctDe(r, "M")).toEqual([25])
    expect(pctDe(r, "V1")).toEqual([25])
    expect(pctDe(r, "V2")).toEqual([25])
    expect(pctDe(r, "S")).toEqual([])
  })

  it("dentro de un modelo, la regla del propio producto le gana a la de otra variante", () => {
    const r = calcularCampaniasOraculo(
      [prod("V1", { grupoId: "M" }), prod("V2", { grupoId: "M" })],
      [
        camp([
          { id: "r1", tipo: "producto", alegraId: "V1", pct: 25 },
          { id: "r2", tipo: "producto", alegraId: "V2", pct: 0 },
        ]),
      ],
      CATS,
      AHORA,
    )
    expect(pctDe(r, "V1")).toEqual([25])
    expect(pctDe(r, "V2")).toEqual([])
  })

  it("una campaña terminada hace más de 24 h no entra; hace menos, sí", () => {
    const reglas: CampaniaOraculo["reglas"] = [{ id: "r1", tipo: "marca", marca: "acme", pct: 20 }]
    const viejas = calcularCampaniasOraculo(
      [prod("P1", { marca: "acme" })],
      [camp(reglas, { inicio: h(-72), fin: h(-25) })],
      CATS,
      AHORA,
    )
    const recientes = calcularCampaniasOraculo(
      [prod("P1", { marca: "acme" })],
      [camp(reglas, { inicio: h(-72), fin: h(-23) })],
      CATS,
      AHORA,
    )
    expect(pctDe(viejas, "P1")).toEqual([])
    expect(pctDe(recientes, "P1")).toEqual([20])
  })

  it("varias campañas: una entrada por campaña, ordenadas por inicio", () => {
    const r = calcularCampaniasOraculo(
      [prod("P1", { marca: "acme" })],
      [
        camp([{ id: "r2", tipo: "marca", marca: "acme", pct: 30 }], { id: "c2", inicio: h(24), fin: h(48) }),
        camp([{ id: "r1", tipo: "marca", marca: "acme", pct: 20 }], { id: "c1", inicio: h(-24), fin: h(24) }),
      ],
      CATS,
      AHORA,
    )
    expect((r.get("P1") ?? []).map((e) => e.campaniaId)).toEqual(["c1", "c2"])
  })
})
