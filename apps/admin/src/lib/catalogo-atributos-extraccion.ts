/**
 * Atributos técnicos de un producto a partir de su NOMBRE (y descripción de Alegra), para
 * `public.catalog_atributos` con `fuente = 'nombre'` (catálogo asistido fase 2, subproyecto 5).
 *
 * En Central LED las especificaciones viven en el nombre ("REFLECTOR LED 50W CALIDO", "PANEL
 * PLAFON CUADRADO 12W AC85-265V CALIDO 3000K"). Este parser es conservador a propósito: ante la
 * duda no devuelve nada. Un valor que falta lo completa la ficha PDF o el panel manual (de mayor
 * precedencia); un valor INVENTADO filtraría mal en la tienda.
 *
 * Reglas medidas sobre el catálogo (2026-09-30):
 * - `potencia_w`: número + "W" (o "KW" × 1000). "2X36W" no cuenta (varios tubos: ambiguo).
 * - `temperatura_k`: cuatro cifras + "K" entre 1800 y 10000. "10kA" (poder de corte) no cuenta.
 * - `tono`: la palabra (cálido/neutro/frío, "luz día", warm/daylight); si no está, desde los kelvin.
 *   Dos tonos distintos en el nombre ("CALIDO/FRIO") = sin tono.
 * - `ip`: "IP" + dos cifras (IPX4 no se guarda).
 * - `flujo_lm`: número (con separador de miles) + "lm"/"lúmenes". El "5050" de las tiras es el chip.
 * - `tension_v`: número + V/VCA/VAC/VCC/VDC/volts. Un rango ("AC85-265V") guarda el texto "85-265"
 *   y como número 220 si lo incluye (tensión de red), si no el tope. "230/400V" guarda el texto y
 *   el primero. Los amperes (100A, 10kA) nunca son tensión ni potencia.
 * - `zocalo`: E10/E12/E14/E27/E40, GU10, GU5.3, MR11/MR16, G4/G9/G13/G24, GX53, R7S.
 *
 * Módulo puro (sin DB): lo usan la sync de Alegra, el backfill y la normalización de lo que lee el
 * PDF o carga el panel (`normalizarAtributos`).
 */

export const CLAVES_ATRIBUTO = [
  "potencia_w",
  "temperatura_k",
  "tono",
  "ip",
  "flujo_lm",
  "tension_v",
  "zocalo",
] as const
export type ClaveAtributo = (typeof CLAVES_ATRIBUTO)[number]

export const TONOS = ["calido", "neutro", "frio"] as const
export type Tono = (typeof TONOS)[number]

export interface AtributoExtraido {
  clave: ClaveAtributo
  valorNum: number | null
  valorTexto: string | null
}

/** Etiquetas para el admin (el Shop tiene las suyas). */
export const ETIQUETA_ATRIBUTO: Record<ClaveAtributo, string> = {
  potencia_w: "Potencia (W)",
  temperatura_k: "Temperatura de color (K)",
  tono: "Tono de luz",
  ip: "Protección IP",
  flujo_lm: "Flujo luminoso (lm)",
  tension_v: "Tensión (V)",
  zocalo: "Zócalo",
}

/** Minúsculas y sin tildes. */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
}

/** Número con coma o punto decimal ("4,5" → 4.5). */
function numero(s: string): number {
  return Number(s.replace(",", "."))
}

/** Borde izquierdo: nada alfanumérico ni separador decimal pegado antes. */
const INI = "(?:^|[^0-9a-z.,])"
/** Borde derecho. */
const FIN = "(?![0-9a-z])"

const RE_POTENCIA = new RegExp(`${INI}(\\d+(?:[.,]\\d+)?) ?(k?)(?:w|watts?)${FIN}`)
const RE_KELVIN = new RegExp(`(?:^|[^0-9.,])(\\d{4}) ?°? ?k${FIN}`)
const RE_IP = new RegExp(`${INI}ip ?-?(\\d)(\\d)${FIN}`)
const RE_LUMENES = new RegExp(`${INI}(\\d{1,3}(?:\\.\\d{3})+|\\d+) ?(?:lm|lumen|lumenes)${FIN}`)
const UNIDAD_V = "(?:v|vca|vac|vcc|vdc|volts?)"
const RE_TENSION = new RegExp(
  `${INI}(?:ac|dc)? ?(\\d{1,3})(?: ?${UNIDAD_V}? ?([-/]) ?(\\d{1,3}))? ?${UNIDAD_V}${FIN}`,
)
const RE_ZOCALO = new RegExp(`${INI}(e ?-?(?:10|12|14|27|40)|gu ?-?(?:10|5[.,]3)|mr ?-?(?:11|16)|gx ?-?53|g ?-?(?:4|9|13|24)|r7s)${FIN}`)

const PALABRAS_TONO: [Tono, RegExp][] = [
  ["calido", new RegExp(`${INI}(?:calid[oa]s?|warm)${FIN}`)],
  ["neutro", new RegExp(`${INI}neutr[oa]s?${FIN}`)],
  ["frio", new RegExp(`${INI}(?:fri[oa]s?|luz (?:de )?dia|daylight)${FIN}`)],
]

/** Tono de luz según la temperatura de color. null si no es un número razonable. */
export function tonoDeKelvin(k: number): Tono | null {
  if (!Number.isFinite(k) || k < 1800 || k > 10000) return null
  if (k <= 3500) return "calido"
  if (k <= 5000) return "neutro"
  return "frio"
}

/** Tensión nominal de un rango: 220 si lo incluye (red), si no el tope. */
function nominalDeRango(a: number, b: number): number {
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return lo <= 220 && 220 <= hi ? 220 : hi
}

function potencia(t: string): number | null {
  const m = RE_POTENCIA.exec(t)
  if (!m) return null
  // "2X36W": la potencia pegada a una "x" es de cada tubo. El borde lo excluye; esto es explícito.
  const n = numero(m[1]) * (m[2] ? 1000 : 1)
  return n > 0 && n <= 100_000 ? n : null
}

function kelvin(t: string): number | null {
  const m = RE_KELVIN.exec(t)
  if (!m) return null
  const k = Number(m[1])
  return k >= 1800 && k <= 10000 ? k : null
}

function tonoDePalabras(t: string): Tono | null | "ambiguo" {
  const hallados = PALABRAS_TONO.filter(([, re]) => re.test(t)).map(([tono]) => tono)
  if (hallados.length === 0) return null
  return hallados.length === 1 ? hallados[0] : "ambiguo"
}

function tension(t: string): { num: number; texto: string | null } | null {
  const m = RE_TENSION.exec(t)
  if (!m) return null
  const a = Number(m[1])
  if (!m[3]) return a > 0 ? { num: a, texto: null } : null
  const b = Number(m[3])
  if (m[2] === "/") return { num: a, texto: `${a}/${b}` }
  return { num: nominalDeRango(a, b), texto: `${Math.min(a, b)}-${Math.max(a, b)}` }
}

function zocalo(t: string): string | null {
  const m = RE_ZOCALO.exec(t)
  return m ? m[1].replace(/[ -]/g, "").replace(",", ".") : null
}

/**
 * Atributos que se leen del nombre (+ descripción). A lo sumo uno por clave, en el orden de
 * `CLAVES_ATRIBUTO`. Nunca tira.
 */
export function extraerAtributosDeNombre(nombre: string, descripcion?: string | null): AtributoExtraido[] {
  const t = normalizar(`${nombre ?? ""} ${descripcion ?? ""}`).replace(/\s+/g, " ").trim()
  if (!t) return []
  const out: AtributoExtraido[] = []
  const num = (clave: ClaveAtributo, v: number | null) => {
    if (v != null) out.push({ clave, valorNum: v, valorTexto: null })
  }

  num("potencia_w", potencia(t))
  const k = kelvin(t)
  num("temperatura_k", k)
  const palabra = tonoDePalabras(t)
  const tono = palabra === "ambiguo" ? null : (palabra ?? (k != null ? tonoDeKelvin(k) : null))
  if (tono) out.push({ clave: "tono", valorNum: null, valorTexto: tono })
  const ip = RE_IP.exec(t)
  if (ip) num("ip", Number(`${ip[1]}${ip[2]}`))
  const lm = RE_LUMENES.exec(t)
  if (lm) {
    const n = Number(lm[1].replace(/\./g, ""))
    num("flujo_lm", n > 0 ? n : null)
  }
  const v = tension(t)
  if (v) out.push({ clave: "tension_v", valorNum: v.num, valorTexto: v.texto })
  const z = zocalo(t)
  if (z) out.push({ clave: "zocalo", valorNum: null, valorTexto: z })

  const orden = (c: ClaveAtributo) => CLAVES_ATRIBUTO.indexOf(c)
  return out.sort((a, b) => orden(a.clave) - orden(b.clave))
}

/** Rangos válidos de las numéricas (lo que sale de ahí se descarta). */
const RANGO: Partial<Record<ClaveAtributo, [number, number]>> = {
  potencia_w: [0.1, 100_000],
  temperatura_k: [1800, 10000],
  ip: [0, 69],
  flujo_lm: [1, 1_000_000],
  tension_v: [1, 1000],
}

function comoNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "string" && /^\s*\d+(?:[.,]\d+)?\s*$/.test(v)) return numero(v.trim())
  return null
}

function enRango(clave: ClaveAtributo, n: number | null): number | null {
  const r = RANGO[clave]
  if (n == null || !r) return n
  return n >= r[0] && n <= r[1] ? n : null
}

function tonoValido(v: unknown): Tono | null {
  if (typeof v !== "string") return null
  const t = normalizar(v.trim())
  if (/^calid[oa]s?$|^warm$/.test(t)) return "calido"
  if (/^neutr[oa]s?$/.test(t)) return "neutro"
  if (/^fri[oa]s?$|^daylight$|^luz (?:de )?dia$/.test(t)) return "frio"
  return null
}

/**
 * Valores que llegan de afuera (la respuesta del PDF o el panel manual) → atributos válidos.
 * Descarta claves desconocidas, valores fuera de rango y vacíos. Completa `tono` desde
 * `temperatura_k` si no vino (así el filtro de tono de la tienda también lo ve).
 */
export function normalizarAtributos(entrada: unknown): AtributoExtraido[] {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return []
  const e = entrada as Record<string, unknown>
  const out: AtributoExtraido[] = []
  for (const clave of CLAVES_ATRIBUTO) {
    const v = e[clave]
    if (v == null || v === "") continue
    if (clave === "tono") {
      const t = tonoValido(v)
      if (t) out.push({ clave, valorNum: null, valorTexto: t })
    } else if (clave === "zocalo") {
      const z = typeof v === "string" ? zocalo(normalizar(` ${v.trim()} `)) : null
      if (z) out.push({ clave, valorNum: null, valorTexto: z })
    } else if (clave === "tension_v") {
      const rango = typeof v === "string" ? /^\s*(\d{1,3})\s*([-/])\s*(\d{1,3})\s*$/.exec(v) : null
      if (rango) {
        const [a, b] = [Number(rango[1]), Number(rango[3])]
        out.push(
          rango[2] === "/"
            ? { clave, valorNum: a, valorTexto: `${a}/${b}` }
            : { clave, valorNum: nominalDeRango(a, b), valorTexto: `${Math.min(a, b)}-${Math.max(a, b)}` },
        )
      } else {
        const n = enRango(clave, comoNumero(v))
        if (n != null) out.push({ clave, valorNum: n, valorTexto: null })
      }
    } else {
      const n = enRango(clave, comoNumero(v))
      if (n != null) out.push({ clave, valorNum: clave === "ip" ? Math.trunc(n) : n, valorTexto: null })
    }
  }
  if (!out.some((a) => a.clave === "tono")) {
    const k = out.find((a) => a.clave === "temperatura_k")?.valorNum
    const tono = k != null ? tonoDeKelvin(k) : null
    if (tono) out.push({ clave: "tono", valorNum: null, valorTexto: tono })
  }
  const orden = (c: ClaveAtributo) => CLAVES_ATRIBUTO.indexOf(c)
  return out.sort((a, b) => orden(a.clave) - orden(b.clave))
}

export type EdicionManual =
  | { ok: true; valores: AtributoExtraido[]; quitar: ClaveAtributo[] }
  | { ok: false; error: string; campo: string }

/**
 * Cuerpo del PUT del panel manual: `{ valores: { <clave>: valor | null } }`. `null` o "" quita la
 * clave; un valor lo fija como `manual`. Un valor que no se puede interpretar es un error (no se
 * descarta en silencio: el operador tiene que saber que no se guardó).
 */
export function parsearEdicionManual(body: unknown): EdicionManual {
  const valores = (body as { valores?: unknown } | null)?.valores
  if (!valores || typeof valores !== "object" || Array.isArray(valores)) {
    return { ok: false, error: "Indique los valores a guardar.", campo: "valores" }
  }
  const out: AtributoExtraido[] = []
  const quitar: ClaveAtributo[] = []
  for (const [clave, v] of Object.entries(valores as Record<string, unknown>)) {
    if (!(CLAVES_ATRIBUTO as readonly string[]).includes(clave)) {
      return { ok: false, error: "Hay un dato técnico desconocido.", campo: clave }
    }
    const c = clave as ClaveAtributo
    if (v == null || (typeof v === "string" && v.trim() === "")) {
      quitar.push(c)
      continue
    }
    // Normaliza la clave sola (sin completar el tono desde los kelvin: eso es del PDF).
    const [a] = normalizarAtributos({ [c]: v }).filter((x) => x.clave === c)
    if (!a) return { ok: false, error: `El valor de "${ETIQUETA_ATRIBUTO[c]}" no es válido.`, campo: c }
    out.push(a)
  }
  return { ok: true, valores: out, quitar }
}
