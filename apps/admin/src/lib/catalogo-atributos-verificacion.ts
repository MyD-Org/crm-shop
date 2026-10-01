/**
 * Verificador determinista de atributos leídos de un PDF por un modelo (módulo PURO: sin red, sin
 * base, sin archivos). El modelo propone {valor, cita?} por atributo y una `fila` por producto; este
 * código decide qué se acepta. El modelo NUNCA carga nada por su cuenta.
 *
 * EVIDENCIA POSICIONAL. Las tablas de los catálogos salen de pdfjs por celdas (muchas veces por
 * columna: encabezado y valor NO son texto contiguo), así que la cita ya no se exige literal (es
 * informativa). Se trabaja con los items de texto y sus coordenadas:
 *
 * 1. El VALOR se busca en las celdas (con el rótulo de su línea: "IP" + "20"): número + unidad
 *    normalizados (coma o punto), o el término del vocabulario / sus sinónimos.
 * 2. Ficha propia de UN producto: se acepta si el valor es el ÚNICO de esa magnitud en el PDF. Los
 *    términos de vocabulario sin unidad (color, montaje, tono, curva, zócalo) se aceptan igual si hay un
 *    único término de esa clave. Si hay varios valores distintos: hace falta `fila` y la regla 3.
 * 3. Tabla o variantes: la `fila` tiene que coincidir con el producto (código de Alegra sin sufijo de
 *    marca, o todos los tokens número+unidad del nombre: 20W, 63A, 300x1200, en las celdas de esa
 *    fila o columna) Y el valor tiene que estar en la MISMA línea que el identificador de la fila (tabla
 *    normal) o en la MISMA columna (tabla transpuesta: los modelos son encabezados de columna, se
 *    detecta porque hay otros identificadores de la misma forma en su línea).
 * 4. CRUCE CON EL NOMBRE: si el nombre ya dice otro valor para la misma clave, se descarta el del PDF
 *    ("contradice_nombre").
 * 5. SIN CAPA DE TEXTO: no se carga nada ("sin_texto").
 * 6. Rangos y vocabularios de `normalizarAtributos` siguen aplicando ("valor_invalido").
 */
import {
  CLAVES_ATRIBUTO,
  DEFINICION_ATRIBUTOS,
  extraerAtributosDeNombre,
  medidasValidas,
  normalizarAtributos,
  type AtributoExtraido,
  type ClaveAtributo,
} from "./catalogo-atributos-extraccion"
import { agruparLineas, textoDeItems, tieneTexto, type ItemTexto } from "./catalogo-ficha-texto"

export const MOTIVOS = [
  "sin_texto",
  "fila_ausente",
  "fila_no_en_texto",
  "fila_no_coincide",
  "valor_fuera_de_fila",
  "valor_invalido",
  "valor_no_en_texto",
  "unidad_no_en_texto",
  "contradice_nombre",
  "conflicto_entre_lecturas",
  "clave_desconocida",
  "producto_desconocido",
  "pdf_inexistente",
  "pdf_ilegible",
  "pdf_fuera_del_directorio",
  "linea_invalida",
] as const
export type Motivo = (typeof MOTIVOS)[number]

/** Una línea de `lectura/crudo/*.jsonl`: lo que escribe el subagente (dato NO confiable). */
export interface LecturaCruda {
  id: string
  /** Ruta relativa al directorio de trabajo: `pdfs/<archivo>` o `recortes/<archivo>`. */
  pdf: string
  /** Identificador literal de la fila/variante (o columna) usada: modelo o código; null si la ficha es de un solo producto. */
  fila: string | null
  /** `cita` es opcional e informativa: no decide nada. */
  atributos: Record<string, { valor: unknown; cita?: unknown }>
}

export interface ContextoVerificacion {
  /** Código de Alegra del producto (`catalog_products.code`). */
  code: string | null
  nombre: string
  /** Items de texto con coordenadas por página; null si no se pudo extraer. */
  paginas: ItemTexto[][] | null
  /** ¿El PDF es la ficha propia de un único producto? */
  unicoProducto: boolean
}

export type ReglaAceptacion = "unico" | "vocabulario" | "fila"

export interface Aceptado {
  clave: ClaveAtributo
  valorNum: number | null
  valorTexto: string | null
  cita: string | null
  /** Qué regla lo aceptó y el texto del PDF que lo respalda (para revisar a ojo). */
  regla: ReglaAceptacion
  evidencia: string
  pagina: number
  /** Si la cita del modelo aparece textual en alguna línea del PDF (informativo). */
  citaEnTexto: boolean
}

export interface Descarte {
  clave: string
  motivo: Motivo
  valor: unknown
  cita: unknown
}

export interface ResultadoVerificacion {
  aceptados: Aceptado[]
  descartes: Descarte[]
}

// ───────────────────────── normalización ─────────────────────────

/** Mayúsculas, sin tildes, guiones unificados, "×" → "X" y espacios colapsados. */
export function normalizarCita(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/×/g, "X")
    .replace(/\s+/g, " ")
    .trim()
}

const compacto = (s: string) => s.replace(/\s+/g, "")
const tieneAlfanum = (s: string) => /[A-Z0-9]/.test(s)
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Todos los números de un texto (coma o punto decimal; "1.200" también cuenta como 1200). */
export function numerosDe(texto: string): Set<number> {
  const out = new Set<number>()
  for (const m of texto.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const t = m[0]
    out.add(Number(t.replace(",", ".")))
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(t)) out.add(Number(t.replace(/[.,]/g, "")))
  }
  return out
}

/** Fuente de regex que matchea un número con coma o punto y separador de miles opcional. */
function altNumero(n: number): string {
  const s = String(n)
  const [ent, dec] = s.split(".")
  const entRe = ent.length > 3 ? `${ent.slice(0, -3)}[.,]?${ent.slice(-3)}` : ent
  return dec ? `${entRe}[.,]${dec}` : entRe
}

// ───────────────────────── código del producto y fila ─────────────────────────

/**
 * Variantes del código de Alegra para buscarlo en la fila: sin el sufijo de marca (`-XYZ`), sólo
 * alfanumérico y, si el prefijo de 2-3 dígitos viene duplicado, también la forma sin la repetición.
 * Se descartan las muy cortas: mezcla de letras y dígitos, mínimo 4 ("RF20"); sólo letras, 6; sólo
 * dígitos, 7 (los números cortos chocan con precios, cantidades y medidas).
 */
export function variantesCodigo(code: string | null | undefined): string[] {
  if (!code) return []
  const nucleo = normalizarCita(code).replace(/-[A-Z]{2,4}$/, "").replace(/[^A-Z0-9]/g, "")
  const vs = [nucleo]
  const dup = /^(\d{2,3})\1/.exec(nucleo)
  if (dup) vs.push(nucleo.slice(dup[1].length))
  const largoMinimo = (v: string) => (/\d/.test(v) && /[A-Z]/.test(v) ? 4 : /^\d+$/.test(v) ? 7 : 6)
  return vs.filter((v) => v.length >= largoMinimo(v))
}

/** Regex del código en un texto normalizado: a lo sumo UN separador entre caracteres, con bordes. */
function regexCodigo(variante: string): RegExp {
  return new RegExp(`(?<![A-Z0-9])${[...variante].map(escapar).join("[ .\\-/]?")}(?![A-Z0-9])`)
}

const largoMinimoCodigo = (v: string) => (/\d/.test(v) && /[A-Z]/.test(v) ? 4 : /^\d+$/.test(v) ? 7 : 6)

/**
 * ¿La fila identifica a este código de Alegra? Tres formas:
 * - la fila ES el código (sin sufijo de marca, con o sin separadores; sirve un SKU corto "3537");
 * - el código figura dentro de la fila (con las longitudes mínimas de `variantesCodigo`);
 * - la fila es el modelo y el código de Alegra le agrega variante y marca ("EFLG2-100W" ⊂
 *   "EFLG2-100W-WW-MCL"), con la misma longitud mínima.
 */
export function filaCoincideConCodigo(filaNorm: string, code: string | null | undefined): boolean {
  if (!code) return false
  const filaCore = filaNorm.replace(/[^A-Z0-9]/g, "")
  const codeNorm = normalizarCita(code)
  const nucleo = codeNorm.replace(/-[A-Z]{2,4}$/, "").replace(/[^A-Z0-9]/g, "")
  const dup = /^(\d{2,3})\1/.exec(nucleo)
  const nucleos = dup ? [nucleo, nucleo.slice(dup[1].length)] : [nucleo]
  if (filaCore.length >= 3 && nucleos.includes(filaCore)) return true
  if (variantesCodigo(code).some((v) => regexCodigo(v).test(filaNorm))) return true
  return filaCore.length >= largoMinimoCodigo(filaCore) && regexCodigo(filaCore).test(codeNorm)
}

const UNIDADES_TOKEN = "KVA|KW|KA|MA|MM2|MM|CM|MTS|MT|LM|HZ|AH|W|V|A|K|M"

/**
 * Tokens "número + unidad" del nombre y medidas "AxB" ("REFLECTOR 20W" → 20W; "GABINETE 300X1200"
 * → 300x1200). Cada token es una regex lista para probar contra un texto normalizado.
 */
export function tokensDelNombre(nombre: string): { token: string; re: RegExp }[] {
  let resto = normalizarCita(nombre)
  const out: { token: string; re: RegExp }[] = []
  const dims = /(?<![0-9.,])(\d+(?:[.,]\d+)?(?:\s?X\s?\d+(?:[.,]\d+)?){1,2})(?:\s?(?:MM|CM))?(?![A-Z0-9])/g
  resto = resto.replace(dims, (_m, d: string) => {
    const partes = d.split(/\s?X\s?/)
    out.push({
      token: partes.join("x"),
      re: new RegExp(`(?<![0-9.,])${partes.map((p) => altNumero(Number(p.replace(",", ".")))).join("\\s?X\\s?")}(?![0-9])`),
    })
    return " "
  })
  const unid = new RegExp(`(?<![0-9.,]|[A-WYZ])(\\d+(?:[.,]\\d+)?)\\s?(${UNIDADES_TOKEN})(?![A-Z0-9])`, "g")
  for (const m of resto.matchAll(unid)) {
    const n = Number(m[1].replace(",", "."))
    out.push({
      token: `${n}${m[2]}`,
      re: new RegExp(`(?<![0-9.,])${altNumero(n)}\\s?${m[2]}(?![A-Z0-9])`),
    })
  }
  return out
}

// ───────────────────────── valor dentro de la cita ─────────────────────────

/** Sufijo de unidad y palabras del campo que aceptamos junto al número, por clave numérica. */
const EVIDENCIA_NUM: Partial<Record<ClaveAtributo, { unidad: string; palabra: string }>> = {
  potencia_w: { unidad: "\\s?(?:W|WATTS?)(?![A-Z])", palabra: "POTENCIA" },
  temperatura_k: { unidad: "\\s?K(?![A-Z])", palabra: "TEMPERATURA|KELVIN" },
  flujo_lm: { unidad: "\\s?(?:LM|LUMENES?)(?![A-Z])", palabra: "FLUJO|LUMEN" },
  tension_v: { unidad: "\\s?(?:V|VAC|VCA|VDC|VCC|VOLTS?)(?![A-Z])", palabra: "TENSION|VOLTAJE" },
  corriente_a: { unidad: "\\s?(?:A|AMPS?|AMPERES?|AMPERIOS?)(?![A-Z0-9])", palabra: "CORRIENTE|AMPERAJE|INTENSIDAD" },
  polos: { unidad: "\\s?(?:P|POLOS?)(?![A-Z0-9])", palabra: "POLOS?|POLAR" },
  seccion_mm2: { unidad: "\\s?(?:MM2|MM²|MM\\^2|MMQ)(?![A-Z0-9])", palabra: "SECCION" },
  poder_corte_ka: { unidad: "\\s?KA(?![A-Z])", palabra: "PODER DE CORTE|POTENCIA DE CORTE|ICN|ICU" },
  sensibilidad_ma: { unidad: "\\s?MA(?![A-Z])", palabra: "SENSIBILIDAD|IDN" },
  largo_m: { unidad: "\\s?(?:M|MT|MTS|MTRS|METROS?)(?![A-Z0-9])", palabra: "LARGO|LONGITUD" },
  angulo_grados: { unidad: "\\s?(?:°|º|GRADOS?|DEG)", palabra: "ANGULO|APERTURA|HAZ" },
}

const POLOS_PALABRA: Record<string, number> = { UNIPOLAR: 1, MONOPOLAR: 1, BIPOLAR: 2, TRIPOLAR: 3, TETRAPOLAR: 4 }

type EvidenciaValor = "ok" | "valor_no_en_texto" | "unidad_no_en_texto"

function evidenciaNumerica(clave: ClaveAtributo, a: AtributoExtraido, cita: string): EvidenciaValor {
  const nums = numerosDe(cita)
  if (clave === "ip") {
    return a.valorNum != null && new RegExp(`(?<![A-Z])IP\\s?-?0?${a.valorNum}(?![0-9])`).test(cita)
      ? "ok"
      : nums.has(a.valorNum ?? NaN)
        ? "unidad_no_en_texto"
        : "valor_no_en_texto"
  }
  if (clave === "tension_v") {
    const rango = a.valorTexto ? /^(\d+)[-/](\d+)$/.exec(a.valorTexto) : null
    if (rango) {
      const [x, y] = [Number(rango[1]), Number(rango[2])]
      if (!nums.has(x) || !nums.has(y)) return "valor_no_en_texto"
      const re = new RegExp(
        `(?<![0-9.,])${altNumero(x)}\\s?[-/]\\s?${altNumero(y)}${EVIDENCIA_NUM.tension_v!.unidad}|(?<![0-9.,])${altNumero(y)}\\s?[-/]\\s?${altNumero(x)}${EVIDENCIA_NUM.tension_v!.unidad}`,
      )
      return re.test(cita) || new RegExp(EVIDENCIA_NUM.tension_v!.palabra).test(cita) ? "ok" : "unidad_no_en_texto"
    }
  }
  const n = a.valorNum
  if (n == null) return "valor_no_en_texto"
  if (clave === "polos") {
    for (const [pal, v] of Object.entries(POLOS_PALABRA)) if (v === n && new RegExp(`(?<![A-Z])${pal}`).test(cita)) return "ok"
  }
  const kw = clave === "potencia_w" && new RegExp(`(?<![0-9.,])${altNumero(n / 1000)}\\s?KW(?![A-Z])`).test(cita)
  if (kw) return "ok"
  if (!nums.has(n)) return "valor_no_en_texto"
  const ev = EVIDENCIA_NUM[clave]
  if (!ev) return "ok"
  if (new RegExp(`(?<![0-9.,])${altNumero(n)}${ev.unidad}`).test(cita)) return "ok"
  return new RegExp(ev.palabra).test(cita) ? "ok" : "unidad_no_en_texto"
}

function evidenciaTexto(clave: ClaveAtributo, a: AtributoExtraido, cita: string): EvidenciaValor {
  const v = a.valorTexto ?? ""
  switch (clave) {
    case "tono": {
      const sin: Record<string, RegExp> = {
        calido: /CALID[OA]|WARM/,
        neutro: /NEUTR[OA]|NEUTRAL/,
        frio: /FRI[OA]|COOL|DAYLIGHT|LUZ DE DIA/,
      }
      return sin[v]?.test(cita) ? "ok" : "valor_no_en_texto"
    }
    case "zocalo": {
      const re = new RegExp(`(?<![A-Z0-9])${[...normalizarCita(v)].map(escapar).join("[ -]?")}(?![A-Z0-9])`)
      return re.test(cita) ? "ok" : "valor_no_en_texto"
    }
    case "color":
    case "montaje": {
      // Misma lectura que el nombre: sinónimos del vocabulario, y "LUZ BLANCA" no es color.
      const hallado = extraerAtributosDeNombre(cita).find((x) => x.clave === clave)
      return hallado?.valorTexto === v ? "ok" : "valor_no_en_texto"
    }
    case "curva": {
      const hallado = extraerAtributosDeNombre(cita).find((x) => x.clave === "curva")
      if (hallado?.valorTexto === v) return "ok"
      return new RegExp(`CURVA\\W{0,3}${v.toUpperCase()}(?![A-Z])`).test(cita) ? "ok" : "valor_no_en_texto"
    }
    case "medidas_mm": {
      const dims = cita.matchAll(/(\d+(?:[.,]\d+)?(?:\s?X\s?\d+(?:[.,]\d+)?){1,2})\s?(MM|CM)?(?![A-Z0-9])/g)
      for (const m of dims) if (medidasValidas(`${m[1]}${m[2] ? ` ${m[2]}` : ""}`.toLowerCase()) === v) return "ok"
      return "valor_no_en_texto"
    }
    default:
      return "valor_no_en_texto"
  }
}

export function valorEnCita(a: AtributoExtraido, citaNorm: string): EvidenciaValor {
  return DEFINICION_ATRIBUTOS[a.clave].tipo === "num" ? evidenciaNumerica(a.clave, a, citaNorm) : evidenciaTexto(a.clave, a, citaNorm)
}

// ───────────────────────── documento posicional ─────────────────────────

/** Un fragmento de texto del PDF (ya normalizado) con su posición. `rotulo` = la primera celda de su línea (el rótulo de la fila: "IP", "Potencia"). */
interface Celda {
  norm: string
  x: number
  y: number
  w: number
  h: number
  cx: number
  pag: number
  linea: number
  rotulo: Celda | null
}

interface Doc {
  celdas: Celda[]
  lineas: Celda[][]
}

/** "90 lm/W" (eficiencia) no es flujo ni potencia: se borra antes de leer valores. */
const limpiar = (s: string) => s.replace(/\d+(?:[.,]\d+)?\s?LM\s?\/\s?W(?:ATTS?)?/g, " ")

const docs = new WeakMap<ItemTexto[][], Doc>()

function construirDoc(paginas: ItemTexto[][]): Doc {
  const hit = docs.get(paginas)
  if (hit) return hit
  const celdas: Celda[] = []
  const lineas: Celda[][] = []
  paginas.forEach((items, pag) => {
    for (const ln of agruparLineas(items)) {
      const cs: Celda[] = []
      for (const it of ln) {
        const norm = limpiar(normalizarCita(it.str))
        if (!tieneAlfanum(norm)) continue
        cs.push({ norm, x: it.x, y: it.y, w: it.w, h: it.h, cx: it.x + it.w / 2, pag, linea: lineas.length, rotulo: cs[0] ?? null })
      }
      if (cs.length === 0) continue
      lineas.push(cs)
      celdas.push(...cs)
    }
  })
  const doc = { celdas, lineas }
  docs.set(paginas, doc)
  return doc
}

/** Textos donde se busca un valor en una celda: sola y con el rótulo de su línea ("IP" + "20"). */
const textosDe = (c: Celda) => (c.rotulo ? [c.norm, `${c.rotulo.norm} ${c.norm}`] : [c.norm])

interface Candidato {
  celda: Celda | null
  pag: number
  y: number
  texto: string
}

/** Dónde aparece el valor: celdas (con rótulo) y, si ninguna lo tiene entero, líneas completas. */
function candidatos(a: AtributoExtraido, doc: Doc): Candidato[] {
  const out: Candidato[] = []
  for (const c of doc.celdas) {
    // Con rótulo ("IP" + "20") sólo vale si el valor NO viene ya del rótulo.
    const texto = textosDe(c).find((t) => valorEnCita(a, t) === "ok" && !(c.rotulo && t !== c.norm && valorEnCita(a, c.rotulo.norm) === "ok"))
    if (texto) out.push({ celda: c, pag: c.pag, y: c.y, texto })
  }
  if (out.length) return out
  for (const ln of doc.lineas) {
    const texto = ln.map((c) => c.norm).join(" ")
    if (valorEnCita(a, texto) === "ok") out.push({ celda: null, pag: ln[0].pag, y: ln[0].y, texto })
  }
  return out
}

// ───────────────────────── magnitudes: ¿hay más de un valor? ─────────────────────────

const RE_NUM = "\\d+(?:[.,]\\d+)*"

/** "1.100" de lúmenes es mil cien; en el resto de las magnitudes la coma/punto es decimal. */
function aNumero(t: string, miles: boolean): number {
  return miles && /^\d{1,3}(?:[.,]\d{3})+$/.test(t) ? Number(t.replace(/[.,]/g, "")) : Number(t.replace(",", "."))
}

/** Valores (canónicos, como string) de la magnitud de `clave` que aparecen en un texto normalizado. */
export function terminosEn(clave: ClaveAtributo, texto: string): string[] {
  if (clave === "ip") return [...texto.matchAll(/(?<![A-Z])IP\s?-?(\d{2})(?![0-9])/g)].map((m) => String(Number(m[1])))
  if (clave === "medidas_mm") {
    const out: string[] = []
    for (const m of texto.matchAll(/(\d+(?:[.,]\d+)?(?:\s?X\s?\d+(?:[.,]\d+)?){1,2})\s?(MM|CM)?(?![A-Z0-9])/g)) {
      const v = medidasValidas(`${m[1]}${m[2] ? ` ${m[2]}` : ""}`.toLowerCase())
      if (v) out.push(v)
    }
    return out
  }
  if (DEFINICION_ATRIBUTOS[clave].tipo === "texto") {
    const v = extraerAtributosDeNombre(texto).find((x) => x.clave === clave)?.valorTexto
    return v ? [v.toLowerCase()] : []
  }
  const ev = EVIDENCIA_NUM[clave]
  if (!ev) return []
  const out: string[] = []
  let resto = texto
  if (clave === "tension_v") {
    const rango = new RegExp(`(?<![0-9.,])(\\d+)\\s?([-/])\\s?(\\d+)${ev.unidad}`, "g")
    resto = resto.replace(rango, (_m, a: string, sep: string, b: string) => {
      const [x, y] = [Number(a), Number(b)]
      out.push(sep === "/" ? `${x}/${y}` : `${Math.min(x, y)}-${Math.max(x, y)}`)
      return " "
    })
  }
  if (clave === "polos") {
    for (const [pal, v] of Object.entries(POLOS_PALABRA)) if (new RegExp(`(?<![A-Z])${pal}`).test(resto)) out.push(String(v))
  }
  for (const m of resto.matchAll(new RegExp(`(?<![0-9.,])(${RE_NUM})${ev.unidad}`, "g"))) {
    out.push(String(aNumero(m[1], clave === "flujo_lm")))
  }
  return out
}

function canonico(a: AtributoExtraido): string {
  if (a.clave === "tension_v" && a.valorTexto) return a.valorTexto
  if (a.valorTexto) return a.valorTexto.toLowerCase()
  return String(a.valorNum)
}

// ───────────────────────── la fila: línea o columna ─────────────────────────

/** Forma de un identificador: letras → A, dígitos → 9 ("EFLG2-20W" → "A9-9A"). */
const forma = (s: string) => s.replace(/[A-Z]+/g, "A").replace(/[0-9]+/g, "9")
/** ¿Dos celdas son identificadores "del mismo tipo"? Misma forma y largo parecido ("3537" y "3520", no "3537" y "20"). */
const mismoTipo = (a: Celda, b: Celda) => forma(a.norm) === forma(b.norm) && Math.abs(a.norm.length - b.norm.length) <= 1

const tolY = (a: Celda, b: Celda) => Math.max(2.5, 0.5 * Math.max(a.h, b.h))

interface ContextoFila {
  modo: "fila" | "columna"
  celdas: Celda[]
}

/**
 * Celdas que pertenecen a la fila/variante identificada por `fila`.
 * - Tabla transpuesta (hay otros identificadores de la MISMA forma en su línea: los modelos son
 *   encabezados de columna): la columna = celdas cuyo encabezado más cercano por `x` es `fila`.
 * - Tabla normal: la línea (misma `y`).
 */
function contextoDeFila(doc: Doc, fila: Celda): ContextoFila {
  const linea = doc.lineas[fila.linea]
  const hermanos = linea.filter((c) => c !== fila && mismoTipo(c, fila))
  if (hermanos.length === 0) {
    const enLinea = doc.celdas.filter((c) => c.pag === fila.pag && Math.abs(c.y - fila.y) <= tolY(c, fila))
    // Tabla transpuesta de UNA sola columna (el identificador no tiene hermanos en su línea): los valores
    // están debajo. Sólo si en esa vertical no hay otros identificadores de la misma forma (si los hay,
    // es la columna de ids de una tabla normal y lo de abajo son otras filas).
    const alineada = (c: Celda) => c.pag === fila.pag && c.linea !== fila.linea && Math.abs(c.cx - fila.cx) <= Math.max(0.75 * fila.w, 10)
    const debajo = doc.celdas.filter(alineada)
    if (debajo.length > 0 && !debajo.some((c) => mismoTipo(c, fila))) return { modo: "columna", celdas: [...enLinea, ...debajo] }
    return { modo: "fila", celdas: enLinea }
  }
  const cabeceras = [fila, ...hermanos].sort((a, b) => a.cx - b.cx)
  const saltos = cabeceras
    .slice(1)
    .map((c, i) => c.cx - cabeceras[i].cx)
    .sort((a, b) => a - b)
  const salto = saltos[Math.floor(saltos.length / 2)]
  const tope = Math.max(0.6 * salto, fila.w)
  const celdas = doc.celdas.filter((c) => {
    if (c.pag !== fila.pag) return false
    if (c === fila) return true
    if (c.linea === fila.linea) return false
    const cerca = cabeceras.reduce((m, h) => (Math.abs(h.cx - c.cx) < Math.abs(m.cx - c.cx) ? h : m), cabeceras[0])
    return cerca === fila && Math.abs(c.cx - fila.cx) <= tope
  })
  return { modo: "columna", celdas }
}

/** Celdas donde figura el identificador de la fila (con un separador opcional entre caracteres). */
function ocurrenciasDeFila(filaNorm: string, doc: Doc): Celda[] {
  const re = new RegExp(`(?<![A-Z0-9])${[...filaNorm.replace(/\s+/g, "")].map(escapar).join("[ .\\-/]?")}(?![A-Z0-9])`)
  const celdas = doc.celdas.filter((c) => re.test(c.norm))
  if (celdas.length || compacto(filaNorm).length < 4) return celdas
  // Partido en varias celdas de la misma línea: se toma la primera de esa línea.
  const cf = compacto(filaNorm)
  return doc.lineas.filter((ln) => compacto(ln.map((c) => c.norm).join("")).includes(cf)).map((ln) => ln[0])
}

// ───────────────────────── verificación de una lectura ─────────────────────────

const esClave = (c: string): c is ClaveAtributo => (CLAVES_ATRIBUTO as readonly string[]).includes(c)

function igualesValores(a: AtributoExtraido, b: AtributoExtraido): boolean {
  const numIgual = a.valorNum === b.valorNum || (a.valorNum != null && b.valorNum != null && Math.abs(a.valorNum - b.valorNum) < 1e-9)
  return numIgual && a.valorTexto === b.valorTexto
}

/** Verifica una lectura contra los items del PDF y el nombre/código del producto. Nunca tira. */
export function verificarLectura(lectura: LecturaCruda, ctx: ContextoVerificacion): ResultadoVerificacion {
  const aceptados: Aceptado[] = []
  const descartes: Descarte[] = []
  const descartar = (clave: string, motivo: Motivo, a: { valor: unknown; cita?: unknown }) =>
    descartes.push({ clave, motivo, valor: a.valor, cita: a.cita ?? null })
  const entradas = Object.entries(lectura.atributos ?? {})

  // Regla 5: sin capa de texto no hay evidencia posible.
  if (!ctx.paginas || !tieneTexto(ctx.paginas.map(textoDeItems))) {
    for (const [clave, a] of entradas) descartar(clave, "sin_texto", a ?? { valor: null })
    return { aceptados, descartes }
  }
  const doc = construirDoc(ctx.paginas)
  const textoLineas = doc.lineas.map((l) => l.map((c) => c.norm).join(" ")).join("\n")
  const textoCompacto = compacto(textoLineas)

  const fila = typeof lectura.fila === "string" && tieneAlfanum(normalizarCita(lectura.fila)) ? normalizarCita(lectura.fila) : null
  const tokens = tokensDelNombre(ctx.nombre)
  const delNombre = extraerAtributosDeNombre(ctx.nombre)

  // Cada aparición de la fila: ¿es de este producto? ¿qué celdas le pertenecen?
  const apariciones = fila
    ? ocurrenciasDeFila(fila, doc).map((celda) => {
        const c = contextoDeFila(doc, celda)
        const porCodigo = filaCoincideConCodigo(fila, ctx.code)
        const porTokens = tokens.length > 0 && tokens.every((t) => c.celdas.some((x) => t.re.test(x.norm)))
        return { celda, ...c, esDelProducto: porCodigo || porTokens }
      })
    : []

  for (const [clave, bruto] of entradas) {
    const entrada = bruto && typeof bruto === "object" ? bruto : { valor: null }
    if (!esClave(clave)) {
      descartar(clave, "clave_desconocida", entrada)
      continue
    }
    // Regla 6: rango y vocabulario.
    const valido = normalizarAtributos({ [clave]: entrada.valor }).find((x) => x.clave === clave)
    if (!valido) {
      descartar(clave, "valor_invalido", entrada)
      continue
    }
    // 1. El valor está en el PDF.
    const cands = candidatos(valido, doc)
    if (cands.length === 0) {
      const hayNumero = valido.valorNum != null && doc.celdas.some((c) => numerosDe(c.norm).has(valido.valorNum!))
      descartar(clave, hayNumero ? "unidad_no_en_texto" : "valor_no_en_texto", entrada)
      continue
    }
    // 2. ¿Es el único valor de esa magnitud en el PDF?
    const esVocabulario = DEFINICION_ATRIBUTOS[clave].tipo === "texto" && clave !== "medidas_mm"
    const terminos = new Set(doc.celdas.flatMap((c) => textosDe(c).flatMap((t) => terminosEn(clave, t))))
    const unico = terminos.size === 0 || (terminos.size === 1 && terminos.has(canonico(valido)))
    let regla: ReglaAceptacion
    let cand: Candidato = cands[0]
    if (unico && (esVocabulario || ctx.unicoProducto)) {
      regla = esVocabulario ? "vocabulario" : "unico"
    } else {
      // 3. Hay varios valores: tiene que estar en la fila/columna del producto.
      if (fila == null) {
        descartar(clave, "fila_ausente", entrada)
        continue
      }
      if (apariciones.length === 0) {
        descartar(clave, "fila_no_en_texto", entrada)
        continue
      }
      const delProducto = apariciones.filter((a) => a.esDelProducto)
      if (delProducto.length === 0) {
        descartar(clave, "fila_no_coincide", entrada)
        continue
      }
      const hallado = (() => {
        for (const ap of delProducto) {
          for (const c of cands) {
            const pertenece = c.celda
              ? ap.celdas.includes(c.celda) || c.celda === ap.celda
              : ap.modo === "fila" && c.pag === ap.celda.pag && Math.abs(c.y - ap.celda.y) <= tolY(ap.celda, ap.celda)
            if (pertenece) return c
          }
        }
        return null
      })()
      if (!hallado) {
        descartar(clave, "valor_fuera_de_fila", entrada)
        continue
      }
      cand = hallado
      regla = "fila"
    }
    // 4. El nombre manda.
    const enNombre = delNombre.find((x) => x.clave === clave)
    if (enNombre && !igualesValores(enNombre, valido)) {
      descartar(clave, "contradice_nombre", entrada)
      continue
    }
    const cita = typeof entrada.cita === "string" ? entrada.cita : null
    const citaNorm = cita ? normalizarCita(cita) : ""
    aceptados.push({
      clave,
      valorNum: valido.valorNum,
      valorTexto: valido.valorTexto,
      cita,
      regla,
      evidencia: cand.texto,
      pagina: cand.pag + 1,
      citaEnTexto: citaNorm.length >= 3 && (textoLineas.includes(citaNorm) || textoCompacto.includes(compacto(citaNorm))),
    })
  }
  return { aceptados, descartes }
}

/**
 * Una sola respuesta por (producto, clave): si dos lecturas aceptadas dicen cosas distintas se
 * descartan las dos ("conflicto_entre_lecturas"); si dicen lo mismo queda la primera.
 */
export function consolidar<T extends { id: string; clave: ClaveAtributo; valorNum: number | null; valorTexto: string | null }>(
  aceptados: readonly T[],
): { aceptados: T[]; conflictos: T[] } {
  const grupos = new Map<string, T[]>()
  for (const a of aceptados) grupos.set(`${a.id}|${a.clave}`, [...(grupos.get(`${a.id}|${a.clave}`) ?? []), a])
  const ok: T[] = []
  const conflictos: T[] = []
  for (const g of grupos.values()) {
    const primero = { clave: g[0].clave, valorNum: g[0].valorNum, valorTexto: g[0].valorTexto }
    if (g.every((x) => igualesValores({ clave: x.clave, valorNum: x.valorNum, valorTexto: x.valorTexto }, primero))) ok.push(g[0])
    else conflictos.push(...g)
  }
  return { aceptados: ok, conflictos }
}
