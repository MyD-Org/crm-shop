// Oráculo de referencia del cálculo de precios online (change `listas-precio-online`, rebanada B).
//
// La implementación REAL vive en SQL (`calcular_precios_online`, migración 0064). Este módulo es la
// misma regla escrita en TypeScript con aritmética entera exacta, y SOLO lo usan los tests: el
// test unitario fija la matriz de casos y el de integración compara el SQL contra este oráculo
// (incluido un barrido aleatorio con semilla fija). Si las dos implementaciones difieren, falla.
//
// Regla: precio_neto = round_half_up(costo_aplicado x coeficiente_efectivo, 2). Precedencia del
// coeficiente: override de marca > override de categoría > general de la lista. La categoría
// ganadora es la MÁS PROFUNDA entre las categorías del producto y sus ancestros; empate en
// profundidad = mayor coeficiente (DC1). Costo nulo o <= 0 => sin precio (nunca 0).

export interface CategoriaOraculo {
  id: string
  parentId: string | null
  nivel: number
}

export interface OverrideOraculo {
  tipo: "marca" | "categoria"
  /** Marca ya normalizada (lower + trim). */
  marca?: string
  categoriaId?: string
  coeficiente: string
}

export interface ListaOraculo {
  id: string
  coeficiente: string
  activa: boolean
  overrides: OverrideOraculo[]
}

export interface ProductoOraculo {
  /** Costo aplicado (decimal como string, hasta 4 decimales) o null. */
  costo: string | null
  marca: string | null
  /** Categorías propias del producto (hoy el overlay tiene una sola; la regla admite varias). */
  categorias: string[]
}

export interface ResultadoOraculo {
  listaId: string
  coef: string
  origen: string
  /** Neto con 2 decimales, o null si no hay precio. */
  precio: string | null
}

const ESCALA = 4n

/** "1.2500" | "1,25" no: solo punto. Devuelve el valor escalado x10^4 como bigint. */
function aEscalado(n: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(n.trim())
  if (!m) throw new Error(`decimal inválido: ${n}`)
  const dec = (m[2] ?? "").padEnd(Number(ESCALA), "0").slice(0, Number(ESCALA))
  return BigInt(m[1]) * 10n ** ESCALA + BigInt(dec || "0")
}

/** Normaliza un coeficiente a su forma canónica de 4 decimales ("1.5" -> "1.5000"). */
export function coefCanonico(n: string): string {
  const v = aEscalado(n)
  return `${v / 10n ** ESCALA}.${(v % 10n ** ESCALA).toString().padStart(Number(ESCALA), "0")}`
}

/** round_half_up(costo x coef, 2) con aritmética exacta. */
export function precioNeto(costo: string, coef: string): string {
  const prod = aEscalado(costo) * aEscalado(coef) // escala 10^8
  const centavos = (prod + 5n * 10n ** 5n) / 10n ** 6n
  const s = centavos.toString().padStart(3, "0")
  return `${s.slice(0, -2)}.${s.slice(-2)}`
}

export function calcularOraculo(
  producto: ProductoOraculo,
  listas: ListaOraculo[],
  categorias: CategoriaOraculo[],
): ResultadoOraculo[] {
  const porId = new Map(categorias.map((c) => [c.id, c]))
  // Categorías del producto y todos sus ancestros.
  const candidatas = new Map<string, CategoriaOraculo>()
  for (const id of producto.categorias) {
    let cur = porId.get(id)
    const visto = new Set<string>()
    while (cur && !visto.has(cur.id)) {
      visto.add(cur.id)
      candidatas.set(cur.id, cur)
      cur = cur.parentId ? porId.get(cur.parentId) : undefined
    }
  }
  const tieneCosto = producto.costo != null && aEscalado(producto.costo) > 0n
  return listas
    .filter((l) => l.activa)
    .map((l) => {
      const marcaOv = producto.marca
        ? l.overrides.find((o) => o.tipo === "marca" && o.marca === producto.marca)
        : undefined
      let catOv: { cat: CategoriaOraculo; coef: string } | undefined
      for (const o of l.overrides) {
        if (o.tipo !== "categoria" || !o.categoriaId) continue
        const cat = candidatas.get(o.categoriaId)
        if (!cat) continue
        if (
          !catOv ||
          cat.nivel > catOv.cat.nivel ||
          (cat.nivel === catOv.cat.nivel && aEscalado(o.coeficiente) > aEscalado(catOv.coef))
        ) {
          catOv = { cat, coef: o.coeficiente }
        }
      }
      const coef = marcaOv ? marcaOv.coeficiente : catOv ? catOv.coef : l.coeficiente
      const origen = marcaOv ? `marca:${producto.marca}` : catOv ? `categoria:${catOv.cat.id}` : "general"
      return {
        listaId: l.id,
        coef: coefCanonico(coef),
        origen,
        precio: tieneCosto ? precioNeto(producto.costo as string, coef) : null,
      }
    })
}
