/**
 * Verificador determinista de atributos leídos de un PDF por un modelo (módulo PURO: sin red, sin
 * base, sin archivos). El modelo propone {valor, cita} por atributo y una `fila` por producto; este
 * código decide qué se acepta. El modelo NUNCA carga nada por su cuenta.
 *
 * Reglas de rigor (todas se verifican acá, con tests):
 *
 * 1. EVIDENCIA LITERAL: la cita (normalizada: mayúsculas, sin tildes, espacios colapsados) tiene que
 *    aparecer en el texto del PDF y CONTENER el valor (número con coma o punto, con su unidad o con la
 *    palabra del campo; o el término del vocabulario / sus sinónimos). Si no, se descarta con motivo.
 * 2. FILA CORRECTA EN TABLAS: la `fila` (modelo o código de la variante) tiene que aparecer en el texto
 *    y coincidir con el producto: contiene el código de Alegra normalizado (sin sufijo de marca, con o
 *    sin separadores, con o sin prefijo duplicado) O todos los tokens "número + unidad" del nombre
 *    (20W, 63A, 300x1200) aparecen en la fila o en la cita. La cita tiene que incluir la fila (es la
 *    fila completa, no la del vecino). `fila` null sólo se acepta si el PDF es la ficha propia de UN
 *    solo producto.
 * 3. CRUCE CON EL NOMBRE: si el nombre ya dice un valor para la misma clave y el PDF dice otro, se
 *    descarta el del PDF ("contradice_nombre").
 * 4. SIN CAPA DE TEXTO: no se carga nada ("sin_texto").
 * 5. Rangos y vocabularios de `normalizarAtributos` siguen aplicando ("valor_invalido").
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
import { tieneTexto } from "./catalogo-ficha-texto"

export const MOTIVOS = [
  "sin_texto",
  "fila_ausente",
  "fila_no_en_texto",
  "fila_no_coincide",
  "fila_fuera_de_cita",
  "cita_ausente",
  "valor_invalido",
  "cita_no_en_texto",
  "valor_no_en_cita",
  "unidad_no_en_cita",
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
  /** Identificador literal de la fila/variante usada (modelo o código); null si la ficha es de un solo producto. */
  fila: string | null
  atributos: Record<string, { valor: unknown; cita: unknown }>
}

export interface ContextoVerificacion {
  /** Código de Alegra del producto (`catalog_products.code`). */
  code: string | null
  nombre: string
  /** Texto por página; null si no se pudo extraer. */
  textoPaginas: string[] | null
  /** ¿El PDF es la ficha propia de un único producto? (si no, `fila` es obligatoria). */
  unicoProducto: boolean
}

export interface Aceptado {
  clave: ClaveAtributo
  valorNum: number | null
  valorTexto: string | null
  cita: string
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

const SEP_PAGINA = " \u0001 "
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

export function filaCoincideConCodigo(filaNorm: string, code: string | null | undefined): boolean {
  return variantesCodigo(code).some((v) => regexCodigo(v).test(filaNorm))
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

type EvidenciaValor = "ok" | "valor_no_en_cita" | "unidad_no_en_cita"

function evidenciaNumerica(clave: ClaveAtributo, a: AtributoExtraido, cita: string): EvidenciaValor {
  const nums = numerosDe(cita)
  if (clave === "ip") {
    return a.valorNum != null && new RegExp(`(?<![A-Z])IP\\s?-?0?${a.valorNum}(?![0-9])`).test(cita)
      ? "ok"
      : nums.has(a.valorNum ?? NaN)
        ? "unidad_no_en_cita"
        : "valor_no_en_cita"
  }
  if (clave === "tension_v") {
    const rango = a.valorTexto ? /^(\d+)[-/](\d+)$/.exec(a.valorTexto) : null
    if (rango) {
      const [x, y] = [Number(rango[1]), Number(rango[2])]
      if (!nums.has(x) || !nums.has(y)) return "valor_no_en_cita"
      const re = new RegExp(
        `(?<![0-9.,])${altNumero(x)}\\s?[-/]\\s?${altNumero(y)}${EVIDENCIA_NUM.tension_v!.unidad}|(?<![0-9.,])${altNumero(y)}\\s?[-/]\\s?${altNumero(x)}${EVIDENCIA_NUM.tension_v!.unidad}`,
      )
      return re.test(cita) || new RegExp(EVIDENCIA_NUM.tension_v!.palabra).test(cita) ? "ok" : "unidad_no_en_cita"
    }
  }
  const n = a.valorNum
  if (n == null) return "valor_no_en_cita"
  if (clave === "polos") {
    for (const [pal, v] of Object.entries(POLOS_PALABRA)) if (v === n && new RegExp(`(?<![A-Z])${pal}`).test(cita)) return "ok"
  }
  const kw = clave === "potencia_w" && new RegExp(`(?<![0-9.,])${altNumero(n / 1000)}\\s?KW(?![A-Z])`).test(cita)
  if (kw) return "ok"
  if (!nums.has(n)) return "valor_no_en_cita"
  const ev = EVIDENCIA_NUM[clave]
  if (!ev) return "ok"
  if (new RegExp(`(?<![0-9.,])${altNumero(n)}${ev.unidad}`).test(cita)) return "ok"
  return new RegExp(ev.palabra).test(cita) ? "ok" : "unidad_no_en_cita"
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
      return sin[v]?.test(cita) ? "ok" : "valor_no_en_cita"
    }
    case "zocalo": {
      const re = new RegExp(`(?<![A-Z0-9])${[...normalizarCita(v)].map(escapar).join("[ -]?")}(?![A-Z0-9])`)
      return re.test(cita) ? "ok" : "valor_no_en_cita"
    }
    case "color":
    case "montaje": {
      // Misma lectura que el nombre: sinónimos del vocabulario, y "LUZ BLANCA" no es color.
      const hallado = extraerAtributosDeNombre(cita).find((x) => x.clave === clave)
      return hallado?.valorTexto === v ? "ok" : "valor_no_en_cita"
    }
    case "curva": {
      const hallado = extraerAtributosDeNombre(cita).find((x) => x.clave === "curva")
      if (hallado?.valorTexto === v) return "ok"
      return new RegExp(`CURVA\\W{0,3}${v.toUpperCase()}(?![A-Z])`).test(cita) ? "ok" : "valor_no_en_cita"
    }
    case "medidas_mm": {
      const dims = cita.matchAll(/(\d+(?:[.,]\d+)?(?:\s?X\s?\d+(?:[.,]\d+)?){1,2})\s?(MM|CM)?(?![A-Z0-9])/g)
      for (const m of dims) if (medidasValidas(`${m[1]}${m[2] ? ` ${m[2]}` : ""}`.toLowerCase()) === v) return "ok"
      return "valor_no_en_cita"
    }
    default:
      return "valor_no_en_cita"
  }
}

export function valorEnCita(a: AtributoExtraido, citaNorm: string): EvidenciaValor {
  return DEFINICION_ATRIBUTOS[a.clave].tipo === "num" ? evidenciaNumerica(a.clave, a, citaNorm) : evidenciaTexto(a.clave, a, citaNorm)
}

// ───────────────────────── verificación de una lectura ─────────────────────────

const esClave = (c: string): c is ClaveAtributo => (CLAVES_ATRIBUTO as readonly string[]).includes(c)

function igualesValores(a: AtributoExtraido, b: AtributoExtraido): boolean {
  const numIgual = a.valorNum === b.valorNum || (a.valorNum != null && b.valorNum != null && Math.abs(a.valorNum - b.valorNum) < 1e-9)
  return numIgual && a.valorTexto === b.valorTexto
}

/** Verifica una lectura contra el texto del PDF y el nombre/código del producto. Nunca tira. */
export function verificarLectura(lectura: LecturaCruda, ctx: ContextoVerificacion): ResultadoVerificacion {
  const aceptados: Aceptado[] = []
  const descartes: Descarte[] = []
  const descartar = (clave: string, motivo: Motivo, a: { valor: unknown; cita: unknown }) =>
    descartes.push({ clave, motivo, valor: a.valor, cita: a.cita })
  const entradas = Object.entries(lectura.atributos ?? {})

  // Regla 4: sin capa de texto no hay evidencia posible.
  if (!ctx.textoPaginas || !tieneTexto(ctx.textoPaginas)) {
    for (const [clave, a] of entradas) descartar(clave, "sin_texto", a ?? { valor: null, cita: null })
    return { aceptados, descartes }
  }
  const texto = ctx.textoPaginas.map(normalizarCita).join(SEP_PAGINA)
  const textoCompacto = compacto(texto)

  // Regla 2 (parte de entrada): la fila tiene que existir en el texto.
  const fila = typeof lectura.fila === "string" && tieneAlfanum(normalizarCita(lectura.fila)) ? normalizarCita(lectura.fila) : null
  let motivoFila: Motivo | null = null
  let filaPorCodigo = false
  if (fila == null) {
    if (!ctx.unicoProducto) motivoFila = "fila_ausente"
  } else {
    const enTexto = texto.includes(fila) || (compacto(fila).length >= 4 && textoCompacto.includes(compacto(fila)))
    if (!enTexto) motivoFila = "fila_no_en_texto"
    else filaPorCodigo = filaCoincideConCodigo(fila, ctx.code)
  }
  const tokens = tokensDelNombre(ctx.nombre)
  if (!motivoFila && fila != null && !filaPorCodigo && tokens.length === 0) motivoFila = "fila_no_coincide"

  const delNombre = extraerAtributosDeNombre(ctx.nombre)

  for (const [clave, a] of entradas) {
    const entrada = a && typeof a === "object" ? a : { valor: null, cita: null }
    if (!esClave(clave)) {
      descartar(clave, "clave_desconocida", entrada)
      continue
    }
    if (motivoFila) {
      descartar(clave, motivoFila, entrada)
      continue
    }
    if (typeof entrada.cita !== "string" || !tieneAlfanum(normalizarCita(entrada.cita))) {
      descartar(clave, "cita_ausente", entrada)
      continue
    }
    const cita = normalizarCita(entrada.cita)
    // Regla 5: rango y vocabulario.
    const valido = normalizarAtributos({ [clave]: entrada.valor }).find((x) => x.clave === clave)
    if (!valido) {
      descartar(clave, "valor_invalido", entrada)
      continue
    }
    // Regla 1: la cita es textual y contiene el valor.
    const enTexto = texto.includes(cita) || (compacto(cita).length >= 4 && textoCompacto.includes(compacto(cita)))
    if (cita.length < 3 || !enTexto) {
      descartar(clave, "cita_no_en_texto", entrada)
      continue
    }
    const ev = valorEnCita(valido, cita)
    if (ev !== "ok") {
      descartar(clave, ev, entrada)
      continue
    }
    // Regla 2 (parte por cita): con fila, la cita tiene que ser de ESA fila (la incluye). Sin esto el modelo
    // podría pedir la fila correcta y citar la del vecino.
    if (fila != null && !cita.includes(fila) && !(compacto(fila).length >= 4 && compacto(cita).includes(compacto(fila)))) {
      descartar(clave, "fila_fuera_de_cita", entrada)
      continue
    }
    // Regla 2 (parte por producto): sin código en la fila, TODOS los tokens del nombre en fila o cita.
    if (fila != null && !filaPorCodigo) {
      const zona = `${fila} ${cita}`
      if (!tokens.every((t) => t.re.test(zona))) {
        descartar(clave, "fila_no_coincide", entrada)
        continue
      }
    }
    // Regla 3: el nombre manda.
    const enNombre = delNombre.find((x) => x.clave === clave)
    if (enNombre && !igualesValores(enNombre, valido)) {
      descartar(clave, "contradice_nombre", entrada)
      continue
    }
    aceptados.push({ clave, valorNum: valido.valorNum, valorTexto: valido.valorTexto, cita: entrada.cita })
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
    if (g.every((x) => igualesValores({ clave: x.clave, valorNum: x.valorNum, valorTexto: x.valorTexto }, { clave: g[0].clave, valorNum: g[0].valorNum, valorTexto: g[0].valorTexto }))) ok.push(g[0])
    else conflictos.push(...g)
  }
  return { aceptados: ok, conflictos }
}
