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
 * - `tono` (Tipo de luz): la palabra (cálido/neutro/frío, "luz día", warm/daylight), una luz de color
 *   ("LUZ VERDE"; un color suelto no cuenta) o RGB/RGBW; si no está, desde los kelvin.
 *   Dos tonos distintos en el nombre ("CALIDO/FRIO") = sin tono.
 * - `ip`: "IP" + dos cifras (IPX4 no se guarda).
 * - `flujo_lm`: número (con separador de miles) + "lm"/"lúmenes". El "5050" de las tiras es el chip.
 * - `tension_v`: número + V/VCA/VAC/VCC/VDC/volts. Un rango ("AC85-265V") guarda el texto "85-265"
 *   y como número 220 si lo incluye (tensión de red), si no el tope. "230/400V" guarda el texto y
 *   el primero. Los amperes (100A, 10kA) nunca son tensión ni potencia.
 * - `zocalo`: E10/E12/E14/E27/E40, GU10, GU5.3, MR11/MR16, G4/G9/G13/G24, GX53, R7S.
 *
 * Claves ampliadas (migración 0053): corriente_a, polos, seccion_mm2, medidas_mm, color,
 * poder_corte_ka, curva, sensibilidad_ma, largo_m, montaje, angulo_grados. Migración 0058: leds_m
 * ("60 LED/m") y potencia_w_m ("14,4 W/m"), que se leen ANTES de descartar lo "por metro" (la potencia
 * por metro nunca es `potencia_w`). Migración 0059: leds_rollo ("300 LED", total del rollo; sólo si el nombre dice "por rollo",
 * "x rollo", "totales" o "total"). Se leen en un pipeline
 * CON CONSUMO (cada regla borra lo que leyó para que la siguiente no lo reinterprete: "10kA" no es
 * corriente, "3X1.5MM2" no son medidas). `seccion_mm2` también se lee sin "mm2" ("2,5MM", "3X2,5", "UNIPOLAR 2.5")
 * pero SOLO en un cable por el nombre y con valores de la serie comercial (`seccionDeCable`). Ante la duda no devuelven nada; dos valores distintos de
 * la misma clave en el nombre = ninguno. Los vocabularios cerrados (color, montaje, curva) viven
 * acá, en código, no en el CHECK de la base: ampliarlos no necesita migración.
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
  "corriente_a",
  "polos",
  "seccion_mm2",
  "medidas_mm",
  "color",
  "poder_corte_ka",
  "curva",
  "sensibilidad_ma",
  "largo_m",
  "montaje",
  "angulo_grados",
  "leds_m",
  "potencia_w_m",
  "leds_rollo",
] as const
export type ClaveAtributo = (typeof CLAVES_ATRIBUTO)[number]

/**
 * Valores de `tono`, que es el "Tipo de luz": blanca (cálido/neutro/frío), de color o RGB. El nombre
 * de la clave y el CHECK de la base no cambian; el vocabulario vive acá (sin migración).
 */
export const TONOS = [
  "calido",
  "neutro",
  "frio",
  "rojo",
  "verde",
  "azul",
  "amarillo",
  "naranja",
  "ambar",
  "violeta",
  "rosa",
  "rgb",
  "rgbw",
] as const
export type Tono = (typeof TONOS)[number]

export const COLORES = [
  "blanco",
  "negro",
  "gris",
  "rojo",
  "azul",
  "verde",
  "amarillo",
  "marron",
  "naranja",
  "transparente",
  "plateado",
  "dorado",
] as const
export type Color = (typeof COLORES)[number]

export const MONTAJES = ["embutir", "aplicar", "colgante", "riel", "din"] as const
export type Montaje = (typeof MONTAJES)[number]

export const CURVAS = ["b", "c", "d"] as const

export interface AtributoExtraido {
  clave: ClaveAtributo
  valorNum: number | null
  valorTexto: string | null
}

/**
 * Registro único de claves: tipo de almacenamiento (`num` ⇒ valor_num, `texto` ⇒ valor_texto),
 * etiqueta del admin, rango válido de las numéricas y pista del panel. Record exhaustivo: una clave
 * nueva en `CLAVES_ATRIBUTO` sin definición no compila. El rango vive en código, no en el CHECK.
 */
export interface DefinicionAtributo {
  tipo: "num" | "texto"
  etiqueta: string
  rango?: [number, number]
  /** Si es true, un valor no entero se DESCARTA (no se redondea). */
  entero?: boolean
  pista: string
}

export const DEFINICION_ATRIBUTOS: Record<ClaveAtributo, DefinicionAtributo> = {
  potencia_w: { tipo: "num", etiqueta: "Potencia (W)", rango: [0.1, 100_000], pista: "50" },
  temperatura_k: { tipo: "num", etiqueta: "Temperatura de color (K)", rango: [1800, 10000], pista: "3000" },
  tono: { tipo: "texto", etiqueta: "Tipo de luz", pista: TONOS.join(", ") },
  ip: { tipo: "num", etiqueta: "Protección IP", rango: [0, 69], pista: "65" },
  flujo_lm: { tipo: "num", etiqueta: "Flujo luminoso (lm)", rango: [1, 1_000_000], pista: "1200" },
  tension_v: { tipo: "num", etiqueta: "Tensión (V)", rango: [1, 1000], pista: "220 o 85-265" },
  zocalo: { tipo: "texto", etiqueta: "Zócalo", pista: "E27, GU10…" },
  corriente_a: { tipo: "num", etiqueta: "Corriente (A)", rango: [0.1, 6300], pista: "25" },
  polos: { tipo: "num", etiqueta: "Polos", rango: [1, 4], entero: true, pista: "1 a 4" },
  seccion_mm2: { tipo: "num", etiqueta: "Sección (mm²)", rango: [0.5, 1000], pista: "2,5" },
  medidas_mm: { tipo: "texto", etiqueta: "Medidas (mm)", pista: "AxB o AxBxC, p. ej. 300x400" },
  color: { tipo: "texto", etiqueta: "Color del producto", pista: COLORES.join(", ") },
  poder_corte_ka: { tipo: "num", etiqueta: "Poder de corte (kA)", rango: [1, 100], pista: "6" },
  curva: { tipo: "texto", etiqueta: "Curva de disparo", pista: "B, C o D" },
  sensibilidad_ma: { tipo: "num", etiqueta: "Sensibilidad (mA)", rango: [5, 1000], pista: "30" },
  largo_m: { tipo: "num", etiqueta: "Largo (m)", rango: [0.1, 1000], pista: "100" },
  montaje: { tipo: "texto", etiqueta: "Montaje", pista: MONTAJES.join(", ") },
  angulo_grados: { tipo: "num", etiqueta: "Ángulo (°)", rango: [1, 360], entero: true, pista: "60" },
  leds_m: { tipo: "num", etiqueta: "LED por metro (LED/m)", rango: [1, 1000], entero: true, pista: "60 o 120" },
  potencia_w_m: { tipo: "num", etiqueta: "Potencia por metro (W/m)", rango: [0.1, 1000], pista: "4,8 o 14,4" },
  leds_rollo: { tipo: "num", etiqueta: "LED por rollo", rango: [1, 10000], entero: true, pista: "300" },
}

/** Etiquetas para el admin (el Shop tiene las suyas). Derivado de `DEFINICION_ATRIBUTOS`. */
export const ETIQUETA_ATRIBUTO = Object.fromEntries(
  CLAVES_ATRIBUTO.map((c) => [c, DEFINICION_ATRIBUTOS[c].etiqueta]),
) as Record<ClaveAtributo, string>

/** Rangos válidos de las numéricas (lo que sale de ahí se descarta). Derivado de `DEFINICION_ATRIBUTOS`. */
export const RANGO: Partial<Record<ClaveAtributo, [number, number]>> = Object.fromEntries(
  CLAVES_ATRIBUTO.flatMap((c) => {
    const r = DEFINICION_ATRIBUTOS[c].rango
    return r ? [[c, r]] : []
  }),
)

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

/**
 * Luces de color: sólo con la palabra "luz" delante ("LUZ VERDE"). Un color suelto ("CABLE VERDE")
 * es el color del producto, no el tipo de luz.
 */
const PALABRAS_LUZ_COLOR: Record<string, string> = {
  rojo: "roj[oa]s?",
  verde: "verdes?",
  azul: "azul(?:es)?",
  amarillo: "amarill[oa]s?",
  naranja: "naranjas?",
  ambar: "[aá]mbar(?:es)?",
  violeta: "violetas?",
  rosa: "rosas?|rosad[oa]s?",
}
const FRASE_LUZ_COLOR = `luz (?:${Object.values(PALABRAS_LUZ_COLOR).join("|")})`

const PALABRAS_TONO: [Tono, RegExp][] = [
  ["calido", new RegExp(`${INI}(?:calid[oa]s?|warm)${FIN}`)],
  ["neutro", new RegExp(`${INI}neutr[oa]s?${FIN}`)],
  ["frio", new RegExp(`${INI}(?:fri[oa]s?|luz (?:de )?dia|daylight)${FIN}`)],
  ...Object.entries(PALABRAS_LUZ_COLOR).map(
    ([tono, src]) => [tono as Tono, new RegExp(`${INI}luz (?:${src})${FIN}`)] as [Tono, RegExp],
  ),
  ["rgb", new RegExp(`${INI}rgb${FIN}`)],
  ["rgbw", new RegExp(`${INI}rgbw${FIN}`)],
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


// ---------------------------------------------------------------------------------------------
// Claves ampliadas (0053). Una sola implementación de las palabras para el nombre y para la
// entrada externa (PDF / panel).
// ---------------------------------------------------------------------------------------------

const COLOR_PALABRAS: Record<Color, string> = {
  blanco: "blanc[oa]s?|bco",
  negro: "negr[oa]s?",
  gris: "gris(?:es)?",
  rojo: "roj[oa]s?",
  azul: "azul(?:es)?",
  verde: "verdes?",
  amarillo: "amarill[oa]s?",
  marron: "marron(?:es)?",
  naranja: "naranjas?",
  transparente: "transparentes?",
  plateado: "platead[oa]s?",
  dorado: "dorad[oa]s?",
}

const MONTAJE_PALABRAS: Record<Montaje, string> = {
  embutir: "embut(?:ir|ido|ida|e|ible)|empotr(?:ar|ado|ada|able)",
  aplicar: "aplicar|aplicad[oa]|sobrepon(?:er|ible)|sobrepuest[oa]",
  colgante: "colgante|pendular|pendant|suspendid[oa]",
  // "riel din" se evalúa (y consume) antes que "riel".
  din: "riel din|din rail|montaje din",
  riel: "riel|carril|track",
}

/** Frases de tono que contienen un color: "LUZ BLANCA", "BLANCO FRIO" son tono, no color. */
const RE_FRASE_TONO = new RegExp(
  `${INI}(?:luz (?:blanc[oa]s?|calid[oa]s?|fri[oa]s?|neutr[oa]s?|(?:de )?dia)|${FRASE_LUZ_COLOR}|(?:blanc[oa]s?|bco) (?:calid|fri|neutr)[oa]s?|(?:calid|fri|neutr)[oa]s? (?:blanc[oa]s?|bco))${FIN}`,
  "g",
)

const unicaCoincidencia = (palabras: Record<string, string>, t: string): string | null => {
  const hallados = Object.entries(palabras).filter(([, src]) => new RegExp(`${INI}(?:${src})${FIN}`).test(t))
  return hallados.length === 1 ? hallados[0][0] : null
}

/** Texto libre → color del vocabulario (null si no es exactamente uno de sus sinónimos). */
export function colorValido(v: unknown): Color | null {
  if (typeof v !== "string") return null
  const t = normalizar(v.trim())
  for (const c of COLORES) if (new RegExp(`^(?:${COLOR_PALABRAS[c]})$`).test(t)) return c
  return null
}

/** Texto libre → montaje del vocabulario ("de aplicar", "riel din"…). */
export function montajeValido(v: unknown): Montaje | null {
  if (typeof v !== "string") return null
  const t = normalizar(v.trim()).replace(/^(?:de|para|a)\s+/, "")
  if (t === "din") return "din"
  for (const m of MONTAJES) if (new RegExp(`^(?:${MONTAJE_PALABRAS[m]})$`).test(t)) return m
  return null
}

/** "b" | "C" | "curva c" → "b" | "c" | "d". */
export function curvaValida(v: unknown): (typeof CURVAS)[number] | null {
  if (typeof v !== "string") return null
  const m = /^(?:curva )?([bcd])$/.exec(normalizar(v.trim()))
  return m ? (m[1] as (typeof CURVAS)[number]) : null
}

const DIM = "\\d{1,4}(?:[.,]\\d+)?"
const MAX_DIM_MM = 20_000
/** Un número de medida sin ceros de más ("300.0" → "300", "2,50" → "2.5"). */
const fmtDim = (n: number) => String(Math.round(n * 100) / 100)

/**
 * "AxB" / "AxBxC" (separador x, × o *; unidad mm o cm opcional) → "AxB[xC]" en mm, o null.
 * Para texto que llega de afuera (PDF / panel): el operador o el modelo ya dicen que son medidas, así
 * que no aplica la heurística del nombre (que desconfía de dimensiones sin unidad).
 */
export function medidasValidas(v: unknown): string | null {
  if (typeof v !== "string") return null
  const m = new RegExp(`^\\s*(${DIM}(?:\\s*[x×*]\\s*${DIM}){1,2})\\s*(mm|cm)?\\s*$`).exec(normalizar(v))
  if (!m) return null
  const factor = m[2] === "cm" ? 10 : 1
  const dims = m[1].split(/\s*[x×*]\s*/).map((d) => numero(d) * factor)
  if (dims.some((d) => !(d > 0) || d > MAX_DIM_MM)) return null
  return dims.map(fmtDim).join("x")
}

interface Consumo {
  hallados: RegExpExecArray[]
  resto: string
}

/**
 * Busca todas las coincidencias de `re` (el grupo 1 es el borde izquierdo, que se conserva), las
 * BORRA del texto (las cambia por un espacio) y devuelve el resto. `aceptar` puede rechazar una
 * coincidencia: no se consume y no se cuenta.
 */
function consumir(resto: string, re: RegExp, aceptar: (m: RegExpExecArray) => boolean = () => true): Consumo {
  const g = new RegExp(re.source, "g")
  const hallados: RegExpExecArray[] = []
  let out = ""
  let ult = 0
  for (let m = g.exec(resto); m; m = g.exec(resto)) {
    if (m[0] === "") {
      g.lastIndex++
      continue
    }
    if (!aceptar(m)) continue
    hallados.push(m)
    out += `${resto.slice(ult, m.index)}${m[1]} `
    ult = m.index + m[0].length
  }
  return { hallados, resto: out + resto.slice(ult) }
}

/** El único valor distinto de la lista, o null si no hay o hay más de uno (ante la duda, nada). */
function unico<T>(xs: T[]): T | null {
  return xs.length > 0 && xs.every((x) => x === xs[0]) ? xs[0] : null
}

/** Borde izquierdo CAPTURADO (para `consumir`). */
const INIC = "(^|[^0-9a-z.,])"
const NUM = "\\d{1,4}(?:[.,]\\d+)?"

const RE_SECCION = new RegExp(`${INIC}(?:\\d+ ?x ?)?(${NUM}) ?(?:mm2|mm²)${FIN}`)
const RE_MEDIDAS = new RegExp(`${INIC}(${DIM}(?: ?[x×] ?${DIM}){1,2})(?: ?(mm|cm))?${FIN}`)
const RE_KA = new RegExp(`${INIC}(${NUM}) ?ka${FIN}`)
const RE_MA = new RegExp(`${INIC}(\\d{1,4}) ?ma${FIN}`)
const RE_NXA = new RegExp(`${INIC}([1-4])x(${NUM}) ?(?:a|amps?)${FIN}`)
const RE_CURVA_EXPLICITA = new RegExp(`${INIC}curva ?([a-z])${FIN}`)
const RE_CURVA_COMBINADA = new RegExp(`${INIC}([bcd]) ?-?(\\d{1,3})(?: ?a)?${FIN}`)
const RE_POLOS = new RegExp(`${INIC}([1-4]) ?p${FIN}(?! ?\\+)`)
const RE_POLOS_PALABRA = new RegExp(`${INIC}(uni|bi|tri|tetra)polar(?:es)?${FIN}`)
// "5A" / "5 A" / "5 amperes"; "1 A 10V" (rango) no: una "a" suelta seguida de otro número no es unidad.
// Un número pegado a otro por "-" o "/" es un rango ("13-18A") o una relación ("1200/5A"), no una corriente.
const RE_CORRIENTE = new RegExp(`${INIC}(?<![0-9][-/])(${NUM})(?: ?(?:amperes?|amperios?|amps?)| a(?! ?\\d)|a)${FIN}`)
// "25M" dentro de un código de modelo ("NCH8-25M/20", "GUIR-10MT-E27") no es un largo: sin "-" o "/" pegado.
const RE_LARGO = new RegExp(`(^|[^0-9a-z.,/-])(${NUM}) ?(?:metros?|mts?|m)${FIN}(?![-/][0-9a-z])`)
const RE_ANGULO = new RegExp(`${INIC}(\\d{1,3}) ?(?:°|º|grados?|deg)${FIN}`)

/** Corrientes nominales normalizadas (serie IEC) que aceptamos tras una letra de curva ("C16"). */
const SERIE_IEC = new Set([1, 2, 3, 4, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125])
const CONTEXTO_PROTECCION = /termomagnetic|termica|llave|interruptor|disyuntor|automatico|breaker|mcb|\bdin\b|curva|icn/
const SENSIBILIDAD_CONTEXTO = /diferencial|disyuntor|rcd|\bdif\b|sensibilidad/
/** Telecom / cableado de datos: "4P" son pares y "CAT 6A" no son amperes. */
const CONTEXTO_TELECOM = /(?:^|[^a-z0-9])(?:utp|ftp|sftp|rj ?\d+|cat ?[5-8]|coaxil|hdmi|usb|par(?:es)?(?![a-z]))/

/**
 * Sección de un CABLE cuando el nombre no dice "mm2" ("CABLE 2,5MM", "CABLE 3X2,5", "TIPO TALLER 2X1.5",
 * "UNIPOLAR 2.5"). Es la lectura más riesgosa del extractor ("4MM" en un tornillo es un diámetro), así que
 * pide TODO esto y, ante la duda, no devuelve nada:
 * - el nombre dice que es un cable/conductor (`CONTEXTO_CABLE`) y no un accesorio, un cable de acero, de
 *   datos o una protección (`NO_ES_CABLE`, `CONTEXTO_TELECOM`, protección/diferencial);
 * - el valor está en la serie comercial (`SERIE_SECCION_MM2`) y la cantidad de conductores es 1 a 5;
 * - todas las coincidencias dan el mismo valor (dos secciones distintas ⇒ nada) y ninguna cae fuera de la serie.
 * Con "mm2" explícito no se llega acá (lo lee `RE_SECCION`).
 */
const CONTEXTO_CABLE =
  /(?:^|[^0-9a-z])(?:cables?|conductor(?:es)?|cordon(?:es)?|(?:uni|bi|tri|tetra)polar(?:es)?|tipo taller|subterraneo)(?![0-9a-z])/
const NO_ES_CABLE =
  /(?:^|[^0-9a-z])(?:para|p) (?:cables?|conductor)|grampa|abrazadera|terminal|prensa|pasacable|portacable|canal|bandeja|cano|tubo|conector|ficha|precinto|zapata|borne|puntera|ojal|pinza|cortacable|pelacable|cinta|funda|acero|galvaniz|sintetic|guia|tensor|rele|contactor|fusible|guardamotor/
/** Serie comercial (IEC 60228) de secciones, en mm². */
const SERIE_SECCION_MM2 = new Set([0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630])
/** Lo que no puede seguir a una sección: otra magnitud, un rango, una suma o más decimales. */
const COLA_SECCION = "(?![0-9a-z²/+x×-]|[.,]\\d)"
const RE_SECCION_CABLE_MM = new RegExp(`${INIC}(?:([1-5]) ?x ?)?(${NUM}) ?mm${COLA_SECCION}`)
const RE_SECCION_CABLE_NXS = new RegExp(`${INIC}([1-5]) ?x ?(${NUM})${COLA_SECCION}`)
// "UNIPOLAR 2.5": el número sin unidad pegado al tipo de cable (y sin otra unidad detrás: "UNIPOLAR 100 MTS").
// Grupo 1 vacío (el borde que `consumir` conserva): sólo se consume el número, el "unipolar" queda para `polos`.
const RE_SECCION_CABLE_TIPO = new RegExp(
  `()(?<=(?:^|[^0-9a-z])(?:uni|bi|tri|tetra)polar(?:es)? )(${NUM})(?! ?(?:mm|m|mt|mts|metros?|a|amps?|v|w|kv|hilos?|cm|pares?|x)(?![a-z]))${COLA_SECCION}`,
)

/** ¿El NOMBRE es el de un cable/conductor (y no un accesorio, un cable de acero o de datos)? Lo usa la auditoría. */
export function pareceCable(nombre: string, descripcion?: string | null): boolean {
  const t = normalizar(`${nombre ?? ""} ${descripcion ?? ""}`).replace(/\s+/g, " ").trim()
  return (
    CONTEXTO_CABLE.test(t) &&
    !NO_ES_CABLE.test(t) &&
    !CONTEXTO_TELECOM.test(t) &&
    !CONTEXTO_PROTECCION.test(t) &&
    !SENSIBILIDAD_CONTEXTO.test(t)
  )
}

function seccionDeCable(t: string, resto: string): { valor: number | null; resto: string } {
  const sinCambios = { valor: null, resto }
  if (!CONTEXTO_CABLE.test(t) || NO_ES_CABLE.test(t) || CONTEXTO_TELECOM.test(t)) return sinCambios
  if (CONTEXTO_PROTECCION.test(t) || SENSIBILIDAD_CONTEXTO.test(t)) return sinCambios // protecciones: "bipolar 2x25" es una térmica
  const valores: number[] = []
  let r = resto
  for (const [re, grupo] of [
    [RE_SECCION_CABLE_MM, 3],
    [RE_SECCION_CABLE_NXS, 3],
    [RE_SECCION_CABLE_TIPO, 2],
  ] as const) {
    const c = consumir(r, re)
    r = c.resto
    for (const m of c.hallados) valores.push(numero(m[grupo]))
  }
  if (valores.length === 0) return sinCambios
  const v = unico(valores)
  return { valor: v != null && SERIE_SECCION_MM2.has(v) ? v : null, resto: r }
}

const POLOS_DE_PALABRA: Record<string, number> = { uni: 1, bi: 2, tri: 3, tetra: 4 }

/** Dimensiones de una coincidencia de `RE_MEDIDAS` → "AxB[xC]" en mm, o null si la heurística duda. */
function medidasDeNombre(m: RegExpExecArray): string | null {
  const crudas = m[2].split(/ ?[x×] ?/)
  const unidad = m[3]
  const factor = unidad === "cm" ? 10 : 1
  const dims = crudas.map((d) => numero(d) * factor)
  if (dims.some((d) => !(d > 0) || d > MAX_DIM_MM)) return null
  const entera = (d: string) => /^\d+$/.test(d)
  if (unidad === "mm") {
    // "4x2,5 mm" / "3x16 mm": conductores x sección (cable), no medidas.
    const [primera, ...otras] = crudas
    if (entera(primera) && Number(primera) <= 4 && (crudas.length === 2 || otras.some((d) => !entera(d)))) return null
  } else if (!unidad) {
    // Sin unidad es ambiguo (cm o mm): sólo 3 dimensiones enteras de 2-4 cifras, o 2 enteras >= 100.
    const tres = crudas.length === 3 && crudas.every((d) => /^\d{2,4}$/.test(d))
    const dos = crudas.length === 2 && crudas.every((d) => entera(d) && Number(d) >= 100)
    if (!tres && !dos) return null
  }
  return dims.map(fmtDim).join("x")
}

/**
 * Las once claves de la migración 0053 a partir del nombre ya normalizado. Corre DESPUÉS de las siete
 * originales, que no cambian. Orden de las reglas = orden de consumo.
 */
function extraerAmpliadas(t: string): AtributoExtraido[] {
  const out: AtributoExtraido[] = []
  const num = (clave: ClaveAtributo, v: number | null) => {
    const r = DEFINICION_ATRIBUTOS[clave].rango
    if (v == null || !Number.isFinite(v)) return
    if (r && (v < r[0] || v > r[1])) return
    if (DEFINICION_ATRIBUTOS[clave].entero && !Number.isInteger(v)) return
    out.push({ clave, valorNum: v, valorTexto: null })
  }
  const texto = (clave: ClaveAtributo, v: string | null) => {
    if (v) out.push({ clave, valorNum: null, valorTexto: v })
  }
  let resto = t

  // 1. seccion_mm2: la sección, nunca la cantidad de conductores ("3X1.5MM2" → 1.5).
  let c = consumir(resto, RE_SECCION)
  resto = c.resto
  if (c.hallados.length > 0) {
    num("seccion_mm2", unico(c.hallados.map((m) => numero(m[2]))))
  } else {
    // Sin "mm2": sólo en un cable, y solo valores de la serie comercial.
    const cable = seccionDeCable(t, resto)
    resto = cable.resto
    num("seccion_mm2", cable.valor)
  }

  // 2. medidas_mm
  const medidas: string[] = []
  c = consumir(resto, RE_MEDIDAS, (m) => {
    const v = medidasDeNombre(m)
    if (v) medidas.push(v)
    return v != null
  })
  resto = c.resto
  texto("medidas_mm", unico(medidas))

  // 3. poder_corte_ka (consume "10kA": no es tensión ni corriente)
  c = consumir(resto, RE_KA)
  resto = c.resto
  num("poder_corte_ka", unico(c.hallados.map((m) => numero(m[2]))))

  // 4. sensibilidad_ma: sólo con contexto de diferencial ("4-20mA" es una señal, no sensibilidad)
  if (SENSIBILIDAD_CONTEXTO.test(t)) {
    c = consumir(resto, RE_MA)
    resto = c.resto
    num("sensibilidad_ma", unico(c.hallados.map((m) => Number(m[2]))))
  }

  const polos: number[] = []
  const corriente: number[] = []

  // 5. NxNA: "2X25A" = 2 polos de 25 A ("2X36W" no: termina en W)
  c = consumir(resto, RE_NXA)
  resto = c.resto
  for (const m of c.hallados) {
    polos.push(Number(m[2]))
    corriente.push(numero(m[3]))
  }

  // 6. curva (explícita y combinada "C16", que aporta la corriente)
  const curvas: string[] = []
  c = consumir(resto, RE_CURVA_EXPLICITA)
  resto = c.resto
  for (const m of c.hallados) if ((CURVAS as readonly string[]).includes(m[2])) curvas.push(m[2])
  c = consumir(resto, RE_CURVA_COMBINADA, (m) => SERIE_IEC.has(Number(m[3])) && CONTEXTO_PROTECCION.test(t))
  resto = c.resto
  for (const m of c.hallados) {
    curvas.push(m[2])
    corriente.push(Number(m[3]))
  }
  texto("curva", unico(curvas))

  // 7. polos: "3P" y las palabras (monofásico/trifásico NO son polos)
  c = consumir(resto, RE_POLOS)
  resto = c.resto
  for (const m of c.hallados) polos.push(Number(m[2]))
  c = consumir(resto, RE_POLOS_PALABRA)
  resto = c.resto
  for (const m of c.hallados) polos.push(POLOS_DE_PALABRA[m[2]])

  // 8. corriente_a
  c = consumir(resto, RE_CORRIENTE)
  resto = c.resto
  for (const m of c.hallados) corriente.push(numero(m[2]))

  if (!CONTEXTO_TELECOM.test(t)) {
    num("polos", unico(polos))
    num("corriente_a", unico(corriente))
  }

  // 9. largo_m
  c = consumir(resto, RE_LARGO)
  resto = c.resto
  num("largo_m", unico(c.hallados.map((m) => numero(m[2]))))

  // 10. angulo_grados
  c = consumir(resto, RE_ANGULO)
  resto = c.resto
  num("angulo_grados", unico(c.hallados.map((m) => Number(m[2]))))

  // 11. color: antes se borran las frases de tono ("LUZ BLANCA", "BLANCO FRIO")
  texto("color", unicaCoincidencia(COLOR_PALABRAS, resto.replace(RE_FRASE_TONO, " ")))

  // 12. montaje: "riel din" antes que "riel", y lo consume
  const montajes: string[] = []
  c = consumir(resto, new RegExp(`${INIC}(?:${MONTAJE_PALABRAS.din})${FIN}`))
  resto = c.resto
  if (c.hallados.length > 0) montajes.push("din")
  for (const m of ["embutir", "aplicar", "colgante", "riel"] as const) {
    if (new RegExp(`${INI}(?:${MONTAJE_PALABRAS[m]})${FIN}`).test(resto)) montajes.push(m)
  }
  texto("montaje", unico(montajes))

  return out
}

/**
 * Magnitudes que NO son el valor de la clave aunque lleven su unidad: la eficiencia ("110 lm/W",
 * "90 lm por watt", "lúmenes por watt") no es flujo, y lo "por metro" o "por m²" ("14,4W/m",
 * "1200lm/m", "5A/m", "100W/m²") no es la potencia, el flujo ni la corriente del producto. Se borran
 * del texto antes de leer nada; ante la duda no se devuelve.
 */
const RE_EFICIENCIA = new RegExp(`${INIC}(?:\\d+(?:[.,]\\d+)? ?)?(?:lm|lumenes?) ?(?:/|por) ?(?:w|watts?|vatios?)${FIN}`, "g")
const RE_POR_UNIDAD = new RegExp(
  `${INIC}(?:\\d+(?:[.,]\\d+)? ?)?(?:k?w|watts?|lm|lumenes?|a|amps?|v|ma|ka) ?/ ?(?:m|mt|mts|metros?|m2|m²|cm|mm|h)${FIN}`,
  "g",
)

/** "60 LED/m", "60 LEDs/m", "60LED/M", "60 leds por metro" (sólo enteros: es una densidad de chips). */
const RE_LEDS_M = new RegExp(`${INIC}(\\d{1,4}) ?leds? ?(?:/|por|x) ?(?:m|mt|mts|metros?)(?![0-9a-z²])`)
/** "14.4W/m", "4,8 W/M", "9,6 watts por metro". No toma W/m² ni W/mm. */
const RE_POTENCIA_M = new RegExp(`${INIC}(\\d{1,4}(?:[.,]\\d{1,2})?) ?(?:w|watts?) ?(?:/|por) ?(?:m|mt|mts|metros?)(?![0-9a-z²])`)

/**
 * "300 LED POR ROLLO" (total del rollo): sólo si el nombre lo dice explícito ("por rollo", "x rollo",
 * "LED totales", "total"). "60 LED 5M" suele ser 60 LED/m en un rollo de 5 m: no se extrae nada.
 */
const RE_LEDS_ROLLO = new RegExp(
  `${INIC}(\\d{1,5}) ?leds?(?![0-9a-z²])(?! ?(?:/|por|x) ?(?:m|mt|mts|metros?)(?![0-9a-z²]))`,
)
const RE_TOTAL_EXPLICITO = /(?:^|[^0-9a-z])(?:(?:por|x) ?rollo|total(?:es)?)(?![a-z])/

/** Valores por metro, leídos del texto completo (antes de `sinRelaciones`). Dos distintos = ninguno. */
function porMetro(t: string): AtributoExtraido[] {
  const out: AtributoExtraido[] = []
  const hallar = (re: RegExp, convertir: (x: string) => number): number | null => {
    const g = new RegExp(re.source, "g")
    return unico([...t.matchAll(g)].map((m) => convertir(m[2])))
  }
  const leds = enRango("leds_m", hallar(RE_LEDS_M, Number))
  if (leds != null) out.push({ clave: "leds_m", valorNum: leds, valorTexto: null })
  const w = enRango("potencia_w_m", hallar(RE_POTENCIA_M, numero))
  if (w != null) out.push({ clave: "potencia_w_m", valorNum: w, valorTexto: null })
  if (RE_TOTAL_EXPLICITO.test(t)) {
    const g = new RegExp(RE_LEDS_ROLLO.source, "g")
    const rollo = enRango("leds_rollo", unico([...t.matchAll(g)].map((m) => Number(m[2]))))
    if (rollo != null) out.push({ clave: "leds_rollo", valorNum: rollo, valorTexto: null })
  }
  return out
}

function sinRelaciones(t: string): string {
  return t.replace(RE_EFICIENCIA, "$1 ").replace(RE_POR_UNIDAD, "$1 ")
}

/**
 * Productos cuyo texto trae magnitudes que NO son las suyas. Se decide por el NOMBRE (la descripción
 * es justo la que trae los números engañosos):
 * - un instrumento de medición lista sus rangos ("200mV/2V/20V…", "2A/10A"): no es su tensión ni su
 *   corriente de trabajo;
 * - una caja vacía o un gabinete dice para qué equipo es ("para contactor de 11kW"): no es su potencia.
 */
const INSTRUMENTO_MEDICION =
  /(?:^|[^0-9a-z])(?:multimetros?|testers?|pinzas? (?:amperimetric|voltamperimetric|de corriente)[a-z]*|amperimetros?|voltimetros?|megometros?|megohmetros?|telurimetros?)(?![0-9a-z])/
const CAJA_VACIA = /(?:^|[^0-9a-z])(?:cajas? vacias?|gabinetes?)(?![0-9a-z])/

function clavesDescartadasPorNombre(nombre: string): Set<ClaveAtributo> {
  const n = normalizar(nombre ?? "")
  const fuera = new Set<ClaveAtributo>()
  if (INSTRUMENTO_MEDICION.test(n)) {
    fuera.add("tension_v")
    fuera.add("corriente_a")
  }
  if (CAJA_VACIA.test(n)) fuera.add("potencia_w")
  return fuera
}

/**
 * Atributos que se leen del nombre (+ descripción). A lo sumo uno por clave, en el orden de
 * `CLAVES_ATRIBUTO`. Nunca tira.
 */
export function extraerAtributosDeNombre(nombre: string, descripcion?: string | null): AtributoExtraido[] {
  const completo = normalizar(`${nombre ?? ""} ${descripcion ?? ""}`).replace(/\s+/g, " ").trim()
  const t = sinRelaciones(completo).replace(/\s+/g, " ").trim()
  if (!completo) return []
  const out: AtributoExtraido[] = [...porMetro(completo)]
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

  out.push(...extraerAmpliadas(t))

  const fuera = clavesDescartadasPorNombre(nombre)
  const orden = (c: ClaveAtributo) => CLAVES_ATRIBUTO.indexOf(c)
  return out.filter((a) => !fuera.has(a.clave)).sort((a, b) => orden(a.clave) - orden(b.clave))
}

function comoNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "string" && /^\s*\d+(?:[.,]\d+)?\s*$/.test(v)) return numero(v.trim())
  return null
}

function enRango(clave: ClaveAtributo, n: number | null): number | null {
  if (n == null) return null
  const { rango, entero } = DEFINICION_ATRIBUTOS[clave]
  if (entero && !Number.isInteger(n)) return null
  if (!rango) return n
  return n >= rango[0] && n <= rango[1] ? n : null
}

function tonoValido(v: unknown): Tono | null {
  if (typeof v !== "string") return null
  const t = normalizar(v.trim())
  if (/^calid[oa]s?$|^warm$/.test(t)) return "calido"
  if (/^neutr[oa]s?$/.test(t)) return "neutro"
  if (/^fri[oa]s?$|^daylight$|^luz (?:de )?dia$/.test(t)) return "frio"
  for (const [tono, src] of Object.entries(PALABRAS_LUZ_COLOR)) {
    if (new RegExp(`^(?:luz )?(?:${src})$`).test(t)) return tono as Tono
  }
  if (t === "rgb" || t === "rgbw") return t
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
    } else if (clave === "color") {
      const col = colorValido(v)
      if (col) out.push({ clave, valorNum: null, valorTexto: col })
    } else if (clave === "montaje") {
      const mo = montajeValido(v)
      if (mo) out.push({ clave, valorNum: null, valorTexto: mo })
    } else if (clave === "curva") {
      const cu = curvaValida(v)
      if (cu) out.push({ clave, valorNum: null, valorTexto: cu })
    } else if (clave === "medidas_mm") {
      const me = medidasValidas(v)
      if (me) out.push({ clave, valorNum: null, valorTexto: me })
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
