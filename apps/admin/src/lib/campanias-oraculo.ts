// Oráculo de referencia de la regla de campañas (spec 2026-10-28-campanias-precios-design.md).
//
// La implementación REAL vive en SQL (`calcular_campanias_online`). Este módulo es la misma regla
// escrita en TypeScript y SOLO lo usan los tests: el unitario fija la matriz de casos y el de
// integración compara el SQL contra este oráculo (incluido un barrido aleatorio con semilla fija).
//
// Regla, por producto y por campaña no terminada hace más de 24 h:
//  - producto: la regla cuyo producto es del mismo modelo (`coalesce(grupo_id, alegra_id)`); si hay
//    varias, la del propio producto, después el mayor % y después el menor id de regla.
//  - si no, marca (normalizada lower + trim).
//  - si no, categoría: la del overlay del ancla del modelo y sus ancestros; la más profunda gana,
//    empate de nivel = mayor % y después el menor id de categoría.
// Un % elegido de 0 excluye al producto de esa campaña.

import type { CategoriaOraculo } from "./precios-online-oraculo"

export interface ProductoCampaniaOraculo {
  alegraId: string
  grupoId: string | null
  /** Marca tal cual viene de Alegra (sin normalizar). */
  marca: string | null
  /** Categoría del overlay de ESTE alegra_id (la regla usa la del ancla del modelo). */
  categoriaId: string | null
}

export interface ReglaOraculo {
  id: string
  tipo: "producto" | "marca" | "categoria"
  alegraId?: string
  /** Marca ya normalizada (lower + trim). */
  marca?: string
  categoriaId?: string
  pct: number
  unidades?: number | null
}

export interface CampaniaOraculo {
  id: string
  inicio: Date
  fin: Date
  reglas: ReglaOraculo[]
}

export interface EntradaOraculo {
  campaniaId: string
  reglaId: string
  pct: number
  unidades: number | null
}

const GRACIA_MS = 24 * 3_600_000

/** Orden de texto byte a byte: el mismo que Postgres para uuid en hexa minúscula. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const normalizarMarca = (m: string | null) => {
  const v = (m ?? "").trim().toLowerCase()
  return v === "" ? null : v
}

export function calcularCampaniasOraculo(
  productos: ProductoCampaniaOraculo[],
  campanias: CampaniaOraculo[],
  categorias: CategoriaOraculo[],
  ahora: Date,
): Map<string, EntradaOraculo[]> {
  const porId = new Map(productos.map((p) => [p.alegraId, p]))
  const cats = new Map(categorias.map((c) => [c.id, c]))
  const modelo = (p: ProductoCampaniaOraculo) => p.grupoId ?? p.alegraId

  /** La categoría del ancla del modelo y todos sus ancestros. */
  const ancestros = (p: ProductoCampaniaOraculo): CategoriaOraculo[] => {
    const inicial = porId.get(modelo(p))?.categoriaId ?? null
    const out: CategoriaOraculo[] = []
    const vistas = new Set<string>()
    let c = inicial ? cats.get(inicial) : undefined
    while (c && !vistas.has(c.id)) {
      vistas.add(c.id)
      out.push(c)
      c = c.parentId ? cats.get(c.parentId) : undefined
    }
    return out
  }

  const vigentes = campanias
    .filter((c) => c.fin.getTime() > ahora.getTime() - GRACIA_MS)
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime())

  const res = new Map<string, EntradaOraculo[]>()
  for (const p of productos) {
    const marca = normalizarMarca(p.marca)
    const anc = ancestros(p)
    for (const c of vigentes) {
      const deProducto = c.reglas
        .filter((r) => r.tipo === "producto" && r.alegraId)
        .filter((r) => {
          const rp = porId.get(r.alegraId!)
          return rp != null && modelo(rp) === modelo(p)
        })
        .sort(
          (a, b) =>
            Number(b.alegraId === p.alegraId) - Number(a.alegraId === p.alegraId) || b.pct - a.pct || cmp(a.id, b.id),
        )
      const deMarca = marca ? c.reglas.find((r) => r.tipo === "marca" && r.marca === marca) : undefined
      const deCategoria = c.reglas
        .filter((r) => r.tipo === "categoria")
        .map((r) => ({ r, cat: anc.find((a) => a.id === r.categoriaId) }))
        .filter((x): x is { r: ReglaOraculo; cat: CategoriaOraculo } => x.cat != null)
        .sort((a, b) => b.cat.nivel - a.cat.nivel || b.r.pct - a.r.pct || cmp(a.cat.id, b.cat.id))[0]?.r
      const regla = deProducto[0] ?? deMarca ?? deCategoria
      if (!regla || regla.pct <= 0) continue
      const lista = res.get(p.alegraId) ?? []
      lista.push({ campaniaId: c.id, reglaId: regla.id, pct: regla.pct, unidades: regla.unidades ?? null })
      res.set(p.alegraId, lista)
    }
  }
  return res
}
