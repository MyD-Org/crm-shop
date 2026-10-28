import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import {
  calcularCampaniasOraculo,
  type CampaniaOraculo,
  type ProductoCampaniaOraculo,
  type ReglaOraculo,
} from "@/lib/campanias-oraculo"
import type { CategoriaOraculo } from "@/lib/precios-online-oraculo"
import { seedTenant, truncateAll } from "./helpers"
import { calcularCampanias, seedCampania, seedCategoria, seedProducto, seedRegla } from "./precios-online-helpers"

// `calcular_campanias_online` contra Postgres real, contrastado con el oráculo en TypeScript
// (matriz fija + barrido aleatorio con semilla fija). Datos inventados.

const T = "tenant-camp"
const OTRO = "tenant-otro"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
})
afterAll(async () => {
  await truncateAll()
})

async function ahoraDb(): Promise<Date> {
  const [r] = (await getDb().execute(sql`SELECT now() AS n`)) as unknown as { n: Date | string }[]
  return new Date(r.n)
}
const horas = (base: Date, h: number) => new Date(base.getTime() + h * 3_600_000)

type Esperado = Map<string, { campaniaId: string; reglaId: string; pct: number; unidades: number | null }[]>

function aMapa(filas: Awaited<ReturnType<typeof calcularCampanias>>): Esperado {
  const m: Esperado = new Map()
  for (const f of filas) {
    const l = m.get(f.alegra_id) ?? []
    l.push({ campaniaId: f.campania_id, reglaId: f.regla_id, pct: Number(f.pct), unidades: f.unidades == null ? null : Number(f.unidades) })
    m.set(f.alegra_id, l)
  }
  for (const l of m.values()) l.sort((a, b) => a.campaniaId.localeCompare(b.campaniaId))
  return m
}

function ordenado(m: Esperado): Esperado {
  for (const l of m.values()) l.sort((a, b) => a.campaniaId.localeCompare(b.campaniaId))
  return m
}

describe("calcular_campanias_online: matriz", () => {
  it("marca, exclusión por producto, categoría del ancla, modelo y gracia de 24 h", async () => {
    const ahora = await ahoraDb()
    const madre = await seedCategoria(T, "madre")
    const hija = await seedCategoria(T, "hija", madre, 2)
    await seedProducto(T, { alegraId: "P1", costo: "100", brand: " ACME " })
    await seedProducto(T, { alegraId: "P2", costo: "100", brand: "acme" })
    await seedProducto(T, { alegraId: "M", costo: "100", grupoId: "M", categoriaId: hija })
    await seedProducto(T, { alegraId: "V1", costo: "100", grupoId: "M" })
    await seedProducto(T, { alegraId: "V2", costo: "100", grupoId: "M" })
    await seedProducto(T, { alegraId: "S", costo: "100" })
    // Otro tenant con la misma marca: nunca se mezcla.
    await seedProducto(OTRO, { alegraId: "P1", costo: "100", brand: "acme" })

    const c1 = await seedCampania(T, { inicio: horas(ahora, -24), fin: horas(ahora, 24) })
    const rMarca = await seedRegla(T, c1, { tipo: "marca", marca: "acme", pct: 20 })
    await seedRegla(T, c1, { tipo: "producto", alegraId: "P2", pct: 0 })
    const rCat = await seedRegla(T, c1, { tipo: "categoria", categoriaId: madre, pct: 10 })
    const rCatHija = await seedRegla(T, c1, { tipo: "categoria", categoriaId: hija, pct: 15 })
    const rProd = await seedRegla(T, c1, { tipo: "producto", alegraId: "V1", pct: 30, unidades: 5 })
    // Terminada hace 23 h (entra) y hace 25 h (no entra).
    const c2 = await seedCampania(T, { inicio: horas(ahora, -72), fin: horas(ahora, -23) })
    const rC2 = await seedRegla(T, c2, { tipo: "marca", marca: "acme", pct: 40 })
    const c3 = await seedCampania(T, { inicio: horas(ahora, -72), fin: horas(ahora, -25) })
    await seedRegla(T, c3, { tipo: "marca", marca: "acme", pct: 50 })

    const m = aMapa(await calcularCampanias(T))
    expect(m.get("P1")).toEqual(
      [
        { campaniaId: c1, reglaId: rMarca, pct: 20, unidades: null },
        { campaniaId: c2, reglaId: rC2, pct: 40, unidades: null },
      ].sort((a, b) => a.campaniaId.localeCompare(b.campaniaId)),
    )
    expect(m.get("P2")).toEqual([{ campaniaId: c2, reglaId: rC2, pct: 40, unidades: null }])
    // El modelo M entero toma la regla de producto de V1 (30 % y su límite).
    for (const id of ["M", "V1", "V2"]) {
      expect(m.get(id)).toEqual([{ campaniaId: c1, reglaId: rProd, pct: 30, unidades: 5 }])
    }
    expect(m.get("S")).toBeUndefined()
    // Sin las reglas de producto, el modelo cae a la categoría más profunda del ancla.
    expect(rCat).not.toBe(rCatHija)
  })

  it("variante sin categoría propia toma la categoría del ancla", async () => {
    const ahora = await ahoraDb()
    const madre = await seedCategoria(T, "madre")
    const hija = await seedCategoria(T, "hija", madre, 2)
    await seedProducto(T, { alegraId: "M", costo: "100", grupoId: "M", categoriaId: hija })
    await seedProducto(T, { alegraId: "V2", costo: "100", grupoId: "M" })
    const c1 = await seedCampania(T, { inicio: horas(ahora, -1), fin: horas(ahora, 1) })
    await seedRegla(T, c1, { tipo: "categoria", categoriaId: madre, pct: 10 })
    const rHija = await seedRegla(T, c1, { tipo: "categoria", categoriaId: hija, pct: 15 })
    const m = aMapa(await calcularCampanias(T))
    expect(m.get("V2")).toEqual([{ campaniaId: c1, reglaId: rHija, pct: 15, unidades: null }])
  })

  it("p_ids restringe el cálculo", async () => {
    const ahora = await ahoraDb()
    await seedProducto(T, { alegraId: "A", costo: "100", brand: "acme" })
    await seedProducto(T, { alegraId: "B", costo: "100", brand: "acme" })
    const c1 = await seedCampania(T, { inicio: horas(ahora, -1), fin: horas(ahora, 1) })
    await seedRegla(T, c1, { tipo: "marca", marca: "acme", pct: 20 })
    const filas = await calcularCampanias(T, ["A"])
    expect(filas.map((f) => f.alegra_id)).toEqual(["A"])
  })
})

describe("calcular_campanias_online contra el oráculo (barrido con semilla fija)", () => {
  function rng(seed: number) {
    return () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const elegir = <X,>(r: () => number, xs: X[]): X => xs[Math.floor(r() * xs.length)]

  it("150 productos y 3 campañas aleatorias coinciden con el oráculo", async () => {
    const r = rng(20261028)
    const ahora = await ahoraDb()

    // Árbol de categorías de 3 niveles.
    const categorias: CategoriaOraculo[] = []
    for (let i = 0; i < 3; i++) {
      const raiz = await seedCategoria(T, `r${i}`)
      categorias.push({ id: raiz, parentId: null, nivel: 1 })
      for (let j = 0; j < 2; j++) {
        const hija = await seedCategoria(T, `r${i}h${j}`, raiz, 2)
        categorias.push({ id: hija, parentId: raiz, nivel: 2 })
        const nieta = await seedCategoria(T, `r${i}h${j}n`, hija, 3)
        categorias.push({ id: nieta, parentId: hija, nivel: 3 })
      }
    }
    const marcas = ["acme", " Acme", "bravo", "charlie", null]

    const productos: ProductoCampaniaOraculo[] = []
    for (let i = 0; i < 150; i++) {
      const alegraId = `p${i}`
      const enModelo = r() < 0.3
      const grupoId = enModelo ? `p${Math.floor(i / 5) * 5}` : null
      const categoriaId = r() < 0.6 ? elegir(r, categorias).id : null
      const marca = elegir(r, marcas)
      productos.push({ alegraId, grupoId, marca, categoriaId })
      await seedProducto(T, { alegraId, costo: "100", brand: marca, grupoId, categoriaId })
    }

    const ventanas: [number, number][] = [
      [-24, 24],
      [-72, -12], // terminada dentro de la gracia
      [-96, -48], // terminada fuera de la gracia
    ]
    const campanias: CampaniaOraculo[] = []
    for (const [a, b] of ventanas) {
      const inicio = horas(ahora, a)
      const fin = horas(ahora, b)
      const id = await seedCampania(T, { inicio, fin })
      const reglas: ReglaOraculo[] = []
      const usados = new Set<string>()
      for (let k = 0; k < 12; k++) {
        const tipo = elegir(r, ["producto", "marca", "categoria"] as const)
        const pct = elegir(r, [0, 5, 10, 20, 35, 50])
        const objetivo =
          tipo === "producto" ? elegir(r, productos).alegraId : tipo === "marca" ? elegir(r, ["acme", "bravo", "charlie"]) : elegir(r, categorias).id
        const clave = `${tipo}:${objetivo}`
        if (usados.has(clave)) continue
        usados.add(clave)
        const unidades = tipo === "producto" && r() < 0.3 ? 1 + Math.floor(r() * 10) : null
        const regla: ReglaOraculo =
          tipo === "producto"
            ? { id: "", tipo, alegraId: objetivo, pct, unidades }
            : tipo === "marca"
              ? { id: "", tipo, marca: objetivo, pct }
              : { id: "", tipo, categoriaId: objetivo, pct }
        regla.id = await seedRegla(T, id, { ...regla, unidades })
        reglas.push(regla)
      }
      campanias.push({ id, inicio, fin, reglas })
    }

    const sqlRes = aMapa(await calcularCampanias(T))
    const oraculo = ordenado(calcularCampaniasOraculo(productos, campanias, categorias, ahora))
    expect(sqlRes).toEqual(oraculo)
  })
})
