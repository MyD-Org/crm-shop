import type { AlegraCategory, AlegraPrice, AlegraProduct } from "./alegra"
import type { TipoItem } from "./variantes-puras"

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
//
// Variantes (change `variantes-de-producto`, S3): el padre y sus variantes comparten `reference`, así
// que el código solo no identifica un ítem. La clave de pareo es `código` para los simples y
// `código#opción` para las variantes (la opción normalizada, sin el nombre del atributo). El PADRE
// no se parea como vendible: se parea aparte (`parearPadres`) para unificar el grupo. Un simple y una
// variante con el mismo código (cruce) no se parean: van a revisar. Sin `tipo` (ítems de antes de las
// variantes) todo se comporta como siempre.

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
  /** Sin `tipo` = simple (comportamiento de antes de las variantes). */
  tipo?: TipoItem
  /** Clave normalizada de la opción (`claveVariante`); solo las variantes la tienen. */
  varianteClave?: string | null
}

export interface ItemSecundarioPareo {
  alegraId: string
  code: string | null
  tipo?: TipoItem
  varianteClave?: string | null
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

/** Variante con código pero sin opción resoluble: no se puede parear. */
export interface SinOpcionPareo {
  lado: "principal" | "secundaria"
  alegraId: string
}

export interface ParPadrePareo {
  principalAlegraId: string
  secundarioAlegraId: string
}

export interface ResultadoPadres {
  /** Padre de la secundaria con un único padre activo del mismo código en la principal. */
  pares: ParPadrePareo[]
  /** Ids de padres de la secundaria sin par: serán ancla solo-secundaria de su grupo. */
  sinPar: string[]
}

export interface ResultadoPareo {
  pares: ParPareo[]
  soloSecundaria: SoloSecundariaPareo[]
  /** Duplicados reales (mismo código y misma opción) y cruces simple/variante con el mismo código. */
  duplicados: DuplicadoPareo[]
  sinCodigo: SinCodigoPareo[]
  sinOpcion: SinOpcionPareo[]
  padres: ResultadoPadres
}

interface Clasificado<T> {
  it: T
  tipo: TipoItem
  code: string
  /** Solo "ok" entra al pareo; el resto se separa. */
  estado: "ok" | "padre" | "sinCodigo" | "sinOpcion"
  /** Clave de pareo: `código` (simple) o `código#opción` (variante). */
  clave: string
}

function clasificar<T extends { code: string | null; tipo?: TipoItem; varianteClave?: string | null }>(it: T): Clasificado<T> {
  const tipo = it.tipo ?? "simple"
  const code = normalizarCodigo(it.code)
  if (tipo === "padre") return { it, tipo, code, estado: "padre", clave: code }
  if (!code) return { it, tipo, code, estado: "sinCodigo", clave: "" }
  if (tipo === "variante") {
    const opcion = it.varianteClave ?? ""
    if (!opcion) return { it, tipo, code, estado: "sinOpcion", clave: "" }
    return { it, tipo, code, estado: "ok", clave: `${code}#${opcion}` }
  }
  return { it, tipo, code, estado: "ok", clave: code }
}

function agrupar<T>(items: Clasificado<T>[]): Map<string, T[]> {
  const porClave = new Map<string, T[]>()
  for (const c of items) {
    if (c.estado !== "ok") continue
    const lista = porClave.get(c.clave)
    if (lista) lista.push(c.it)
    else porClave.set(c.clave, [c.it])
  }
  return porClave
}

/**
 * Pareo de PADRES (aparte del de los vendibles): un padre de la secundaria se parea con el padre
 * ACTIVO de la principal si su código es único a ambos lados. Sirve para unificar el grupo: las
 * variantes solo-secundaria de un padre pareado cuelgan del padre de la principal.
 */
export function parearPadres(principales: ItemPrincipalPareo[], secundarios: ItemSecundarioPareo[]): ResultadoPadres {
  const porCodigoP = new Map<string, ItemPrincipalPareo[]>()
  for (const it of principales) {
    if ((it.tipo ?? "simple") !== "padre" || !it.activo) continue
    const c = normalizarCodigo(it.code)
    if (!c) continue
    porCodigoP.set(c, [...(porCodigoP.get(c) ?? []), it])
  }
  const padresS = secundarios.filter((it) => (it.tipo ?? "simple") === "padre")
  const cuentaS = new Map<string, number>()
  for (const it of padresS) {
    const c = normalizarCodigo(it.code)
    if (c) cuentaS.set(c, (cuentaS.get(c) ?? 0) + 1)
  }
  const out: ResultadoPadres = { pares: [], sinPar: [] }
  for (const it of padresS) {
    const c = normalizarCodigo(it.code)
    const delLado = c ? (porCodigoP.get(c) ?? []) : []
    if (c && cuentaS.get(c) === 1 && delLado.length === 1) {
      out.pares.push({ principalAlegraId: delLado[0].alegraId, secundarioAlegraId: it.alegraId })
    } else {
      out.sinPar.push(it.alegraId)
    }
  }
  return out
}

/**
 * Empareja los ítems de una cuenta secundaria contra el espejo de la principal.
 * Sólo cuentan como "activas" de la principal las filas con `activo`; las inactivas se usan
 * únicamente para marcar la adopción (O8). Un ítem principal sin código no se puede parear.
 * Los padres se excluyen del pareo de vendibles (ver `parearPadres`).
 */
export function parearPorCodigo(principales: ItemPrincipalPareo[], secundarios: ItemSecundarioPareo[]): ResultadoPareo {
  const cp = principales.map(clasificar)
  const cs = secundarios.map(clasificar)
  const p = agrupar(cp)
  const s = agrupar(cs)

  const res: ResultadoPareo = {
    pares: [],
    soloSecundaria: [],
    duplicados: [],
    sinCodigo: [],
    sinOpcion: [],
    padres: parearPadres(principales, secundarios),
  }

  for (const c of cp) {
    if (!c.it.activo) continue
    if (c.estado === "sinCodigo") res.sinCodigo.push({ lado: "principal", alegraId: c.it.alegraId })
    if (c.estado === "sinOpcion") res.sinOpcion.push({ lado: "principal", alegraId: c.it.alegraId })
  }
  for (const c of cs) {
    if (c.estado === "sinCodigo") res.sinCodigo.push({ lado: "secundaria", alegraId: c.it.alegraId })
    if (c.estado === "sinOpcion") res.sinOpcion.push({ lado: "secundaria", alegraId: c.it.alegraId })
  }

  // Cruce: el mismo código lo usan un simple y una variante (de cualquier lado; de la principal solo
  // cuentan las activas). No se sabe qué par corresponde: se informa y no entra ninguno.
  const tiposDe = (xs: Clasificado<{ alegraId: string; activo?: boolean }>[], soloActivas: boolean): Map<string, Set<TipoItem>> => {
    const m = new Map<string, Set<TipoItem>>()
    for (const c of xs) {
      if (c.estado !== "ok") continue
      if (soloActivas && !c.it.activo) continue
      const set = m.get(c.code) ?? new Set<TipoItem>()
      set.add(c.tipo)
      m.set(c.code, set)
    }
    return m
  }
  const tiposP = tiposDe(cp, true)
  const tiposS = tiposDe(cs, false)
  const cruzados = new Set<string>()
  for (const [code, ts] of tiposS) {
    if (new Set<TipoItem>([...ts, ...(tiposP.get(code) ?? [])]).size > 1) cruzados.add(code)
  }
  for (const code of cruzados) {
    res.duplicados.push({
      clave: code,
      principal: cp.filter((c) => c.estado === "ok" && c.code === code && c.it.activo).map((c) => c.it.alegraId),
      secundaria: cs.filter((c) => c.estado === "ok" && c.code === code).map((c) => c.it.alegraId),
    })
  }

  const codigoDeClave = new Map(cs.filter((c) => c.estado === "ok").map((c) => [c.clave, c.code] as const))
  for (const [clave, delLado] of s) {
    if (cruzados.has(codigoDeClave.get(clave) ?? "")) continue
    const enPrincipal = p.get(clave) ?? []
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
  /** Id del padre en SU cuenta -> id del padre de la principal con el que se pareó (S3). */
  padresCanonicos?: ReadonlyMap<string, string>,
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
      // El padre de una variante es un id DE ESA CUENTA: se reescribe al id del padre de la principal si
      // se parearon (el grupo queda unificado) o, si no, al sintético, que coincide con el `alegra_id`
      // de la fila ancla del padre de la secundaria.
      ...(item.padreAlegraId
        ? { padreAlegraId: padresCanonicos?.get(item.padreAlegraId) ?? alegraIdSintetico(cuenta.slug, item.padreAlegraId) }
        : {}),
      raw: { ...item.raw, price: rawPriceRemapeado },
    },
    alegraIdCuenta: item.alegraId,
    listasSinEquivalente,
    categoriaSinEquivalente,
  }
}
