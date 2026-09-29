import type { AlegraCategory, AlegraPrice, AlegraProduct } from "./alegra"

// Pareo de ítems entre cuentas de Alegra (change `sucursales-igz-mdp`, rebanada D, catálogo
// unión, design D2/D14). Puro: sin base ni Alegra. Lo usa `syncCuentaSecundaria`.
//
// El catálogo de la tienda es la UNIÓN de las cuentas del tenant emparejadas por CÓDIGO
// (`reference` de Alegra, normalizado). Reglas:
//  - Código único a ambos lados con la fila principal ACTIVA → PAR: manda la principal (nombre,
//    precio, foto, categoría, IVA, estado) y la secundaria aporta SOLO stock.
//  - Código único en la secundaria y sin fila principal ACTIVA → SOLO-SECUNDARIA: producto
//    legítimo de esa cuenta. Si la principal lo tiene INACTIVO (O8, #671), IGZ se trata como si no
//    lo tuviera: el ítem de la secundaria entra igual como solo-secundaria (`adoptada`).
//  - Código repetido en cualquiera de los dos lados, o ausente: NUNCA entra al catálogo ni al
//    stock. Se informa para corregirlo en Alegra (cargar datos, no código).

/** Normaliza un código para compararlo: trim + minúsculas + sin tildes + espacios colapsados. */
export function normalizarCodigo(code: string | null | undefined): string {
  if (code == null) return ""
  return code
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Fila de la cuenta principal tal como está en el espejo. `activo` = vista Y no inactiva en Alegra. */
export interface ItemPrincipalPareo {
  alegraId: string
  code: string | null
  activo: boolean
}

export interface ItemSecundarioPareo {
  alegraId: string
  code: string | null
}

export interface ParPareo {
  clave: string
  principalAlegraId: string
  secundarioAlegraId: string
}

export interface SoloSecundariaPareo {
  clave: string
  secundarioAlegraId: string
  /** Fila principal INACTIVA con ese código (O8): el ítem fue "adoptado" por la secundaria. */
  principalInactivaAlegraId: string | null
}

export interface DuplicadoPareo {
  clave: string
  principal: string[]
  secundaria: string[]
}

export interface SinCodigoPareo {
  lado: "principal" | "secundaria"
  alegraId: string
}

export interface ResultadoPareo {
  pares: ParPareo[]
  soloSecundaria: SoloSecundariaPareo[]
  duplicados: DuplicadoPareo[]
  sinCodigo: SinCodigoPareo[]
}

function agrupar<T extends { code: string | null }>(items: T[]): { porClave: Map<string, T[]>; sinCodigo: T[] } {
  const porClave = new Map<string, T[]>()
  const sinCodigo: T[] = []
  for (const it of items) {
    const clave = normalizarCodigo(it.code)
    if (!clave) {
      sinCodigo.push(it)
      continue
    }
    const lista = porClave.get(clave)
    if (lista) lista.push(it)
    else porClave.set(clave, [it])
  }
  return { porClave, sinCodigo }
}

/**
 * Empareja los ítems de una cuenta secundaria contra el espejo de la principal.
 * Sólo cuentan como "activas" de la principal las filas con `activo`; las inactivas se usan
 * únicamente para marcar la adopción (O8). Un ítem principal sin código no se puede parear.
 */
export function parearPorCodigo(principales: ItemPrincipalPareo[], secundarios: ItemSecundarioPareo[]): ResultadoPareo {
  const p = agrupar(principales)
  const s = agrupar(secundarios)

  const res: ResultadoPareo = { pares: [], soloSecundaria: [], duplicados: [], sinCodigo: [] }

  for (const it of p.sinCodigo) if (it.activo) res.sinCodigo.push({ lado: "principal", alegraId: it.alegraId })
  for (const it of s.sinCodigo) res.sinCodigo.push({ lado: "secundaria", alegraId: it.alegraId })

  for (const [clave, delLado] of s.porClave) {
    const enPrincipal = p.porClave.get(clave) ?? []
    const activas = enPrincipal.filter((x) => x.activo)
    const inactivas = enPrincipal.filter((x) => !x.activo)

    if (delLado.length > 1 || activas.length > 1) {
      res.duplicados.push({
        clave,
        principal: activas.length > 1 ? activas.map((x) => x.alegraId) : [],
        secundaria: delLado.map((x) => x.alegraId),
      })
      continue
    }

    const sec = delLado[0]
    if (activas.length === 1) {
      res.pares.push({ clave, principalAlegraId: activas[0].alegraId, secundarioAlegraId: sec.alegraId })
    } else {
      res.soloSecundaria.push({
        clave,
        secundarioAlegraId: sec.alegraId,
        principalInactivaAlegraId: inactivas[0]?.alegraId ?? null,
      })
    }
  }

  // Duplicados que existen sólo en la principal no afectan a la secundaria: no se informan acá.
  return res
}

/**
 * Estado de la fila solo-secundaria (O8, #671): un ítem ADOPTADO (la principal lo tiene inactivo)
 * se muestra sólo mientras la secundaria tenga stock; con 0 queda `inactive` y vuelve al reponer.
 * Uno que no compite con ninguna fila principal queda `active` (visibilidad la decide el overlay).
 */
export function estadoSoloSecundaria(adoptada: boolean, stock: number | null): "active" | "inactive" {
  if (!adoptada) return "active"
  return stock != null && stock > 0 ? "active" : "inactive"
}

// ── Mapeo de un ítem de la cuenta secundaria a una fila de `catalog_products` ──

const norm = normalizarCodigo

export interface CuentaParaMapeo {
  id: string
  slug: string
}

export interface ListaPrincipal {
  idPriceList: string
  name: string
}

export interface CategoriaPrincipal {
  alegraId: string
  name: string
}

export interface ItemSecundarioMapeado {
  /** Fila lista para `catalog_products`: `alegraId` = `<slug>:<id_en_cuenta>`. */
  producto: AlegraProduct
  /** Id del ítem en SU cuenta. */
  alegraIdCuenta: string
  /** Listas de la secundaria sin equivalente por nombre en la principal (se descartan). */
  listasSinEquivalente: string[]
  /** true si el ítem tenía categoría en la secundaria y no hay una con el mismo nombre en la principal. */
  categoriaSinEquivalente: boolean
}

/** Id sintético de una fila solo-secundaria. */
export function alegraIdSintetico(slug: string, idEnCuenta: string): string {
  return `${slug}:${idEnCuenta}`
}

/**
 * Los ids de listas de precio y de categorías son POR CUENTA. Para que el precio y la categoría de
 * un producto solo-secundaria signifiquen lo mismo que en la principal:
 *  - las listas se reasignan por NOMBRE normalizado a la de la principal con el mismo nombre; sin
 *    equivalente se descarta (el producto puede quedar sin precio y no venderse: O9);
 *  - la categoría se resuelve por nombre normalizado contra las de la principal; sin match → null.
 * También se reescribe `raw.price` (de ahí sale `precios_alegra`, que lee la vista del Shop).
 */
export function mapItemSecundario(
  item: AlegraProduct,
  cuenta: CuentaParaMapeo,
  listasPrincipal: ListaPrincipal[],
  categoriasSecundaria: Pick<AlegraCategory, "alegraId" | "name">[],
  categoriasPrincipal: CategoriaPrincipal[],
): ItemSecundarioMapeado {
  const listaPorNombre = new Map(listasPrincipal.map((l) => [norm(l.name), l]))
  const listasSinEquivalente: string[] = []
  const prices: AlegraPrice[] = []
  for (const pr of item.prices) {
    const eq = listaPorNombre.get(norm(pr.name))
    if (!eq) {
      listasSinEquivalente.push(pr.name)
      continue
    }
    prices.push({ idPriceList: eq.idPriceList, name: eq.name, price: pr.price })
  }

  let categoryAlegraId: string | null = null
  let categoriaSinEquivalente = false
  if (item.categoryAlegraId) {
    const nombre = categoriasSecundaria.find((c) => c.alegraId === item.categoryAlegraId)?.name
    const match = nombre ? categoriasPrincipal.find((c) => norm(c.name) === norm(nombre)) : undefined
    categoryAlegraId = match?.alegraId ?? null
    categoriaSinEquivalente = !match
  }

  const rawPrice = Array.isArray(item.raw.price) ? (item.raw.price as Record<string, unknown>[]) : []
  const rawPriceRemapeado = rawPrice.flatMap((p) => {
    const eq = listaPorNombre.get(norm(String(p.name ?? "")))
    if (!eq) return []
    const conTipo = (orig: unknown): unknown => (typeof orig === "number" && /^\d+$/.test(eq.idPriceList) ? Number(eq.idPriceList) : eq.idPriceList)
    return [
      {
        ...p,
        ...("idPriceList" in p ? { idPriceList: conTipo(p.idPriceList) } : {}),
        ...("id" in p ? { id: conTipo(p.id) } : {}),
        name: eq.name,
      },
    ]
  })

  return {
    producto: {
      ...item,
      alegraId: alegraIdSintetico(cuenta.slug, item.alegraId),
      categoryAlegraId,
      prices,
      raw: { ...item.raw, price: rawPriceRemapeado },
    },
    alegraIdCuenta: item.alegraId,
    listasSinEquivalente,
    categoriaSinEquivalente,
  }
}
