import { describe, it, expect } from "vitest"
import casos from "./__fixtures__/envio-zona-casos.json"
import {
  bboxContenidoEn,
  bboxDe,
  bboxInterseca,
  geometriaInterseca,
  puntoEnGeometria,
  validarGeometria,
  type Geometria,
} from "./geo-poligono"

const g = casos.geometrias as unknown as Record<string, Geometria>
const p = casos.puntos

describe("puntoEnGeometria", () => {
  it("dentro, fuera y hueco", () => {
    expect(puntoEnGeometria(p.centro.lat, p.centro.lon, g.centro)).toBe(true)
    expect(puntoEnGeometria(p.afuera.lat, p.afuera.lon, g.centro)).toBe(false)
    expect(puntoEnGeometria(p.hueco.lat, p.hueco.lon, g.centro)).toBe(false)
  })
  it("el borde cuenta como dentro (zonas contiguas sin huecos)", () => {
    expect(puntoEnGeometria(p.borde.lat, p.borde.lon, g.centro)).toBe(true)
    expect(puntoEnGeometria(p.borde.lat, p.borde.lon, g.costa)).toBe(true)
  })
  it("el borde de un hueco pertenece al polígono", () => {
    expect(puntoEnGeometria(-38.0, -57.54, g.centro)).toBe(true)
  })
  it("multipolígono: cualquiera de sus partes", () => {
    expect(puntoEnGeometria(-38.01, -57.19, g.islas)).toBe(true)
    expect(puntoEnGeometria(p.isla2.lat, p.isla2.lon, g.islas)).toBe(true)
    expect(puntoEnGeometria(-38.01, -57.17, g.islas)).toBe(false)
  })
  it("geometría vacía no contiene nada", () => {
    expect(puntoEnGeometria(-38, -57.5, [])).toBe(false)
  })
})

describe("bbox", () => {
  it("bboxDe toma los extremos", () => {
    expect(bboxDe(g.islas)).toEqual({ sur: -38.02, oeste: -57.2, norte: -38.0, este: -57.14 })
  })
  it("bboxInterseca", () => {
    const a = { sur: 0, oeste: 0, norte: 2, este: 2 }
    expect(bboxInterseca(a, { sur: 1, oeste: 1, norte: 3, este: 3 })).toBe(true)
    expect(bboxInterseca(a, { sur: 2, oeste: 2, norte: 3, este: 3 })).toBe(true)
    expect(bboxInterseca(a, { sur: 3, oeste: 3, norte: 4, este: 4 })).toBe(false)
  })
  it("geometriaInterseca: vértice dentro, esquina dentro y cruce de aristas", () => {
    // El rectángulo contiene un vértice de la geometría.
    expect(geometriaInterseca(g.costa, { sur: -38.1, oeste: -57.45, norte: -37.9, este: -57.3 })).toBe(true)
    // El rectángulo está dentro de la geometría (sin vértices de ninguna).
    expect(geometriaInterseca(g.ampliada, { sur: -38.0, oeste: -57.6, norte: -37.99, este: -57.59 })).toBe(true)
    // Cruce en cruz: ninguna esquina ni vértice adentro del otro.
    expect(geometriaInterseca(g.costa, { sur: -38.0, oeste: -57.6, norte: -37.99, este: -57.3 })).toBe(true)
    expect(geometriaInterseca(g.costa, { sur: -37.0, oeste: -57.6, norte: -36.9, este: -57.3 })).toBe(false)
  })
  it("bboxContenidoEn exige las 4 esquinas, ningún cruce y ningún hueco adentro", () => {
    expect(bboxContenidoEn({ sur: -38.04, oeste: -57.59, norte: -38.02, este: -57.51 }, g.centro)).toBe(true)
    // Esquinas dentro pero el hueco queda adentro del rectángulo.
    expect(bboxContenidoEn({ sur: -38.03, oeste: -57.59, norte: -37.97, este: -57.51 }, g.centro)).toBe(false)
    // Una esquina afuera.
    expect(bboxContenidoEn({ sur: -38.04, oeste: -57.55, norte: -38.02, este: -57.45 }, g.centro)).toBe(false)
  })
})

describe("validarGeometria", () => {
  const cuadrado = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]]
  it("acepta las geometrías del fixture y la vacía", () => {
    for (const geo of Object.values(g)) expect(validarGeometria(geo).ok).toBe(true)
    expect(validarGeometria([])).toEqual({ ok: true, g: [] })
  })
  it("rechaza lo que no es un arreglo de polígonos", () => {
    expect(validarGeometria(null).ok).toBe(false)
    expect(validarGeometria({}).ok).toBe(false)
    expect(validarGeometria([[]]).ok).toBe(false)
    expect(validarGeometria([[[]]]).ok).toBe(false)
  })
  it("anillo no cerrado", () => {
    const r = validarGeometria([[[[-57.6, -38.05], [-57.5, -38.05], [-57.5, -37.95], [-57.6, -37.95]]]])
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toMatch(/cerrad/i)
  })
  it("menos de 4 puntos", () => {
    expect(validarGeometria([[[[-57.6, -38.05], [-57.5, -38.05], [-57.6, -38.05]]]]).ok).toBe(false)
  })
  it("coordenadas no finitas o no numéricas", () => {
    const mal = cuadrado(-57.6, -38.05, -57.5, -37.95)
    mal[1] = [Number.NaN, -38.05]
    expect(validarGeometria([[mal]]).ok).toBe(false)
    const texto = cuadrado(-57.6, -38.05, -57.5, -37.95) as unknown[]
    texto[2] = ["a", "b"]
    expect(validarGeometria([[texto]]).ok).toBe(false)
    expect(validarGeometria([[[[1, 2, 3], [1, 2], [1, 2], [1, 2]]]]).ok).toBe(false)
  })
  it("fuera de la caja de Argentina", () => {
    expect(validarGeometria([[cuadrado(0, 0, 1, 1)]]).ok).toBe(false)
    // lat/lon invertidas: [-38, -57.5] sería lon -38 (fuera de caja).
    expect(validarGeometria([[cuadrado(-38.05, -57.6, -37.95, -57.5)]]).ok).toBe(false)
  })
  it("más de 20 polígonos", () => {
    const poligonos = Array.from({ length: 21 }, (_, i) => [cuadrado(-60 + i * 0.1, -38.05, -59.95 + i * 0.1, -37.95)])
    const r = validarGeometria(poligonos)
    expect(r.ok).toBe(false)
    expect(validarGeometria(poligonos.slice(0, 20)).ok).toBe(true)
  })
  it("más de 1000 vértices", () => {
    const n = 1001
    const anillo: number[][] = []
    for (let i = 0; i < n - 1; i++) {
      const ang = (2 * Math.PI * i) / (n - 1)
      anillo.push([-57.5 + 0.1 * Math.cos(ang), -38 + 0.1 * Math.sin(ang)])
    }
    anillo.push(anillo[0])
    const r = validarGeometria([[anillo]])
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(/1000/)
  })
  it("autointersección (moño)", () => {
    const mono = [[-57.6, -38.05], [-57.5, -37.95], [-57.5, -38.05], [-57.6, -37.95], [-57.6, -38.05]]
    const r = validarGeometria([[mono]])
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(/cruz|interse/i)
  })
  it("un hueco que cruza el anillo exterior", () => {
    const ext = cuadrado(-57.6, -38.05, -57.5, -37.95)
    const hueco = cuadrado(-57.55, -38.0, -57.45, -37.99)
    expect(validarGeometria([[ext, hueco]]).ok).toBe(false)
  })
})
