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
 * "x rollo", "totales" o "total"). Migración 0070: diametro_mm (caños, tubos y sus accesorios: "ø25mm", "tubo 20mm") y
 * ancho_mm (bandejas portacables: "BANDEJA PERFORADA 100/50", "TAPA BANDEJA 150"); se leen sólo del NOMBRE y sólo con la palabra
 * de caño/tubo o de bandeja (`diametroDeNombre`, `anchoDeNombre`), fuera del pipeline con consumo. Se leen en un pipeline
 * CON CONSUMO (cada regla borra lo que leyó para que la siguiente no lo reinterprete: "10kA" no es
 * corriente, "3X1.5MM2" no son medidas). `seccion_mm2` también se lee sin "mm2" ("2,5MM", "3X2,5", "UNIPOLAR 2.5")
 * pero SOLO en un cable por el nombre y con valores de la serie comercial (`seccionDeCable`). Ante la duda no devuelven nada; dos valores distintos de
 * la misma clave en el nombre = ninguno. Los vocabularios cerrados (color, montaje, curva) viven
 * acá, en código, no en el CHECK de la base: ampliarlos no necesita migración.
 *
 * Lecturas por FAMILIA del producto (2026-10-07, sólo del nombre): `montaje` cuando el nombre no lo dice
 * (plafón/aplique/estanco → aplicar, araña/luminaria de suspensión → colgante; "de superficie" = aplicar),
 * `largo_m` en centímetros de tubos/listones/regletas/tiras de luz ("120CM" → 1,2), `diametro_mm` de accesorios
 * de caño que no dicen "caño" (curva/unión/grampa/cupla + medida de la serie, también en pulgadas), `ancho_mm`
 * de piezas de bandeja que no dicen "bandeja" ("TEE 200/50") y `tono` desde las siglas WW/NW/CW.
 *
 * Rango de REGULACIÓN de relés térmicos y guardamotores (2026-10-07, `regulacionDeNombre`): "4-6A", "1.6-2.5 A",
 * "4…6 A", "6A A 10A", "Reg: 0,63 - 1A" se guardan como `corriente_a` con `valor_texto` = "4-6" (punto decimal) y
 * `valor_num` = el tope (misma convención que la tensión "85-265"). Sólo con la palabra del aparato en el texto
 * (relé térmico / de sobrecarga, guardamotor, protector térmico o de motor): fuera de ese contexto un "13-18A"
 * sigue sin leerse (puede ser cualquier cosa) y "1200/5A" es una relación. El Shop lo muestra "4–6 A".
 *
 * Migración 0072: dimerizable (texto "si"/"no": "DIMERIZABLE", "DIMEABLE", "DIMMABLE", "TRIAC DIM" o la sigla "DIM" de una lámpara = sí; "NO DIMERIZABLE" y "NO DIM" = no; sólo
 * si el producto ES la lámpara, panel, tira o driver: un dimmer, una tecla o un regulador no son "dimerizables") y modulos (cantidad de
 * módulos DIN de un gabinete, caja o tablero: "p/12 Mod DIN", "12 polos", "10 bocas"; NO los módulos de bastidor de una caja de
 * mecanismos, que son otra unidad). Ver `dimerizableDeTexto` y `modulosDeNombre`.
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
  "diametro_mm",
  "ancho_mm",
  "dimerizable",
  "modulos",
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

/** Valores de `dimerizable` (texto, como `montaje` o `color`): el producto regula su luz con un dimmer, sí o no. */
export const DIMERIZABLES = ["si", "no"] as const
export type Dimerizable = (typeof DIMERIZABLES)[number]

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
  corriente_a: { tipo: "num", etiqueta: "Corriente (A)", rango: [0.1, 6300], pista: "25 o 4-6" },
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
  diametro_mm: { tipo: "num", etiqueta: "Diámetro (mm)", rango: [5, 200], pista: "25" },
  ancho_mm: { tipo: "num", etiqueta: "Ancho (mm)", rango: [30, 1000], entero: true, pista: "150" },
  dimerizable: { tipo: "texto", etiqueta: "Dimerizable", pista: DIMERIZABLES.join(" o ") },
  modulos: { tipo: "num", etiqueta: "Módulos DIN", rango: [1, 200], entero: true, pista: "12" },
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

/**
 * Siglas de tono de los códigos de luminaria: WW (warm white) = cálido, NW = neutro, CW (cool white) =
 * frío. Sólo como token suelto o sufijo separado por guion ("PANEL WW", "XB-50W-CW", "XY-WW-12"): pegadas a
 * un número o a otro código ("15CW", "18CWW") no se leen, y "RGB+WW" no es luz blanca (sigue siendo RGB).
 */
const INI_SIGLA = "(?:^|[^0-9a-z.,+])"
const sigla = (s: string) => `${INI_SIGLA}${s}${FIN}`

const PALABRAS_TONO: [Tono, RegExp][] = [
  ["calido", new RegExp(`(?:${INI}(?:calid[oa]s?|warm)|${sigla("ww")})${FIN}`)],
  ["neutro", new RegExp(`(?:${INI}neutr[oa]s?|${sigla("nw")})${FIN}`)],
  ["frio", new RegExp(`(?:${INI}(?:fri[oa]s?|luz (?:de )?dia|daylight)|${sigla("cw")})${FIN}`)],
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

/**
 * "De superficie" = de aplicar ("TOMA SUPERFICIE", "Caja de superficie"). Sólo se lee del NOMBRE (las
 * descripciones de herramientas y tornillería hablan de la superficie del material) y no es la terminación
 * ("superficie galvanizada", "del cuerpo") ni lo que es PARA una caja de superficie.
 */
const RE_SUPERFICIE = new RegExp(
  `${INI}(?<!para (?:caja )?(?:de )?)superficie(?! (?:del?|galvanizad|cromad|niquelad|pulid|lis|rugos))${FIN}`,
)

/** Texto libre → montaje del vocabulario ("de aplicar", "riel din", "de superficie"…). */
export function montajeValido(v: unknown): Montaje | null {
  if (typeof v !== "string") return null
  const t = normalizar(v.trim()).replace(/^(?:de|para|a)\s+/, "")
  if (t === "din") return "din"
  if (t === "superficie") return "aplicar"
  for (const m of MONTAJES) if (new RegExp(`^(?:${MONTAJE_PALABRAS[m]})$`).test(t)) return m
  return null
}

/** "sí" | "Si" | "no" | true | false → "si" | "no" (lo que el PDF o el panel escriben para `dimerizable`). */
export function dimerizableValido(v: unknown): Dimerizable | null {
  if (v === true) return "si"
  if (v === false) return "no"
  if (typeof v !== "string") return null
  const t = normalizar(v.trim())
  if (t === "si" || t === "true" || t === "yes") return "si"
  if (t === "no" || t === "false") return "no"
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
/** "2 POLOS", "1 POLO" (en letras). "3 POLOS + N" no: el neutro aparte cambia la cuenta. */
const RE_POLOS_EN_LETRAS = new RegExp(`${INIC}([1-4]) ?polos?${FIN}(?! ?\\+)`)
// "5A" / "5 A" / "5 amperes"; "1 A 10V" (rango) no: una "a" suelta seguida de otro número no es unidad.
// Un número pegado a otro por "-" o "/" es un rango ("13-18A") o una relación ("1200/5A"), no una corriente.
const RE_CORRIENTE = new RegExp(`${INIC}(?<![0-9][-/])(${NUM})(?: ?(?:amperes?|amperios?|amps?)| a(?! ?\\d)|a)${FIN}`)
// "25M" dentro de un código de modelo ("NCH8-25M/20", "GUIR-10MT-E27") no es un largo: sin "-" o "/" pegado.
const RE_LARGO = new RegExp(`(^|[^0-9a-z.,/-])(${NUM}) ?(?:metros?|mts?|m)${FIN}(?![-/][0-9a-z])`)
const RE_ANGULO = new RegExp(`${INIC}(\\d{1,3}) ?(?:°|º|grados?|deg)${FIN}`)

/**
 * El producto ES un relé térmico (o de sobrecarga), un guardamotor o un protector térmico/de motor: el único
 * contexto donde "4-6A" es un rango de regulación. Un accesorio "para guardamotor" (caja, contacto) no lo es.
 */
const CONTEXTO_REGULACION =
  /(?:^|[^0-9a-z])(?<!(?:para|p\/) )(?:reles? (?:de sobrecarga )?termicos?|reles? de sobrecarga|relevos? termicos?|guarda ?motor(?:es)?|prot(?:ector|\.)? ?termicos?|protector(?:es)? de motor)(?![0-9a-z])/
/**
 * "4-6A", "1.6-2.5 A", "4…6 A", "6A A 10A", "0,63 - 1A", "REGULACION 17-23". Grupos: 2 = "reg"/"regulación"
 * delante, 3 y 4 = los extremos, 5 = la unidad. Sin unidad sólo vale con "reg" delante ("para 4 a 20 kW" no).
 */
const RE_REGULACION = new RegExp(
  `${INIC}(reg(?:ulacion)?\\.?:? ?)?(${NUM})(?: ?a)?(?: ?(?:-|–|…|\\.\\.\\.) ?| a )(${NUM})(?: ?(a|amps?|amperes?))?${FIN}`,
)

/** Rango de regulación [a, b] (a < b, dentro del rango válido de la corriente) leído del texto, o null. */
function regulacion(m: RegExpExecArray): [number, number] | null {
  if (!m[2] && !m[5]) return null
  const [a, b] = [numero(m[3]), numero(m[4])]
  const r = DEFINICION_ATRIBUTOS.corriente_a.rango!
  return a < b && a >= r[0] && b <= r[1] ? [a, b] : null
}

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
 * Las once claves de la migración 0053 a partir del nombre ya normalizado (`t` = nombre + descripción;
 * `nombre` = sólo el nombre normalizado, para las lecturas por familia). Corre DESPUÉS de las siete
 * originales, que no cambian. Orden de las reglas = orden de consumo.
 */
function extraerAmpliadas(t: string, nombre: string): AtributoExtraido[] {
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

  // 4b. Rango de regulación de un relé térmico o un guardamotor ("4-6A"): sólo con ese contexto. Se consume para que
  // la corriente suelta no lea su tope.
  const rangos: string[] = []
  let tope: number | null = null
  if (CONTEXTO_REGULACION.test(t)) {
    c = consumir(resto, RE_REGULACION, (m) => regulacion(m) !== null)
    resto = c.resto
    for (const m of c.hallados) {
      const [a, b] = regulacion(m)!
      rangos.push(`${a}-${b}`)
      tope = b
    }
  }

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

  // 7. polos: "3P", las palabras y "2 POLOS" (monofásico/trifásico NO son polos)
  c = consumir(resto, RE_POLOS)
  resto = c.resto
  for (const m of c.hallados) polos.push(Number(m[2]))
  c = consumir(resto, RE_POLOS_PALABRA)
  resto = c.resto
  for (const m of c.hallados) polos.push(POLOS_DE_PALABRA[m[2]])
  c = consumir(resto, RE_POLOS_EN_LETRAS)
  resto = c.resto
  for (const m of c.hallados) polos.push(Number(m[2]))

  // 8. corriente_a
  c = consumir(resto, RE_CORRIENTE)
  resto = c.resto
  for (const m of c.hallados) corriente.push(numero(m[2]))

  if (!CONTEXTO_TELECOM.test(t)) {
    num("polos", unico(polos))
    if (rangos.length === 0) num("corriente_a", unico(corriente))
    else {
      // Un solo rango (dos distintos = nada) y ninguna otra corriente que no sea su tope.
      const rango = unico(rangos)
      if (rango && corriente.every((x) => x === tope)) out.push({ clave: "corriente_a", valorNum: tope, valorTexto: rango })
    }
  }

  // 9. largo_m (metros; y centímetros sólo en tubos, listones, regletas y tiras de luz, desde el nombre)
  c = consumir(resto, RE_LARGO)
  resto = c.resto
  num("largo_m", unico([...c.hallados.map((m) => numero(m[2])), ...largosEnCm(nombre)]))

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
  if (RE_SUPERFICIE.test(nombre) && !montajes.includes("aplicar")) montajes.push("aplicar")
  // Sin montaje dicho, el de la familia del producto (sólo del NOMBRE). Con uno o más dichos, manda lo dicho.
  texto("montaje", montajes.length > 0 ? unico(montajes) : montajeDeFamilia(nombre))

  return out
}

/**
 * Largo en centímetros ("120CM", "60 cm") → metros, sólo en un tubo, listón, regleta o tira DE LUZ (el nombre
 * dice LED, T5/T8, vidrio, nano o una potencia): "TUBO LED T8 18W 120CM" = 1,2 m. Un "Ø 60 cm" de un colgante,
 * un barral o una lámpara "120CM" sin esa palabra no se leen. Las medidas "60x60cm" tampoco (son de panel).
 */
const RE_LARGO_CM_CONTEXTO = /(?:^|[^0-9a-z])(?:tubos?|liston(?:es)?|regletas?|tiras?)(?![0-9a-z])/
const RE_LARGO_CM_LUZ = /(?:^|[^0-9a-z])(?:leds?|t5|t8|t12|fluorescentes?|vidrio|nano)(?![0-9a-z])|\d ?w(?![0-9a-z])/
const RE_LARGO_CM_NO = /(?:^|[^0-9a-z])(?:canos?|corrugad[oa]s?|termocontraibles?)(?![0-9a-z])/
const RE_LARGO_CM = /(?<![0-9a-z.,/øǿ⌀-])(?<![x×*] ?)(\d{2,3}) ?cm(?![0-9a-z²³])(?! ?[x×*] ?\d)/g

function largosEnCm(nombre: string): number[] {
  if (!RE_LARGO_CM_CONTEXTO.test(nombre) || !RE_LARGO_CM_LUZ.test(nombre) || RE_LARGO_CM_NO.test(nombre)) return []
  return [...nombre.matchAll(RE_LARGO_CM)].map((m) => Number(m[1])).filter((cm) => cm >= 10 && cm <= 300).map((cm) => cm / 100)
}

/**
 * Montaje por la FAMILIA del producto cuando el nombre no lo dice: el plafón, el plafonier y el aplique se
 * aplican; la araña y la luminaria de suspensión cuelgan; un estanco (luminaria, gabinete o caja estanca) se
 * aplica. Sólo del nombre y sólo si el producto ES de la familia: un accesorio "para aplique", una tapa o un
 * interruptor "con caja estanca", o un trapecio "de suspensión" (bandejas) no lo son.
 */
const RE_FAMILIA_APLICAR = /(?:^|[^0-9a-z])(?<!(?:para|p\/) ?)(?:plafon(?:es)?|plafonier(?:es|s)?|apliques?)(?![0-9a-z])/
const RE_FAMILIA_COLGANTE = /(?:^|[^0-9a-z])aranas?(?![0-9a-z])/
const RE_SUSPENSION = /(?:^|[^0-9a-z])suspension(?![0-9a-z])/
const RE_ESTANCO = /(?:^|[^0-9a-z])(?<!(?:c\/|con|p\/|para|tapa) (?:(?:una|la) )?(?:caja )?)estanc[oa]s?(?![0-9a-z])/
/** Señales de luminaria (para "suspensión" y "estanco"). */
const RE_LUMINARIA = /(?:^|[^0-9a-z])(?:leds?|luminarias?|artefactos?|lamparas?|tubos?|e27|e40|t8|t5)(?![0-9a-z])|\d ?w(?![0-9a-z])/
/** Envolventes que se aplican cuando son estancas. */
const RE_ENVOLVENTE = /(?:^|[^0-9a-z])(?:gabinetes?|gab\.|cajas?|tableros?)(?![0-9a-z])/
/** El producto es un accesorio o un aparato distinto de la familia (se mira la primera palabra). */
const RE_NO_ES_FAMILIA =
  /^(?:\d+ )?(?:accesorios?|kits?|soportes?|sujetador(?:es)?|trapecios?|gr\.|grampas?|extensor(?:es)?|conector(?:es)?|prensa\w*|acoples?|bastidor(?:es)?|tapas?|interruptor(?:es)?|teclas?|tomas?|fichas?|union(?:es)?|cuplas?|boquillas?|selector(?:es)?|conm\w*|repuestos?|drivers?|fuentes?|transformador(?:es)?|trafos?|lamparas?)(?![0-9a-z])/
/** Va sobre una columna o un poste (luminaria de alumbrado): no es de aplicar en pared o techo. */
const RE_COLUMNA = /(?:^|[^0-9a-z])(?:columnas?|postes?)(?![0-9a-z])/

function montajeDeFamilia(nombre: string): Montaje | null {
  if (RE_NO_ES_FAMILIA.test(nombre) || RE_COLUMNA.test(nombre)) return null
  const hallados = new Set<Montaje>()
  if (RE_FAMILIA_APLICAR.test(nombre)) hallados.add("aplicar")
  if (RE_FAMILIA_COLGANTE.test(nombre) || (RE_SUSPENSION.test(nombre) && RE_LUMINARIA.test(nombre))) hallados.add("colgante")
  if (RE_ESTANCO.test(nombre) && (RE_LUMINARIA.test(nombre) || RE_ENVOLVENTE.test(nombre))) hallados.add("aplicar")
  return hallados.size === 1 ? [...hallados][0] : null
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

// ---------------------------------------------------------------------------------------------
// diametro_mm y ancho_mm (0070). Sólo del NOMBRE (la descripción trae medidas de otras cosas) y sólo
// con la palabra del producto: un "20mm" suelto es un tornillo, un espesor o un diámetro de otra cosa.
// ---------------------------------------------------------------------------------------------

/** Caño, tubo o cablecanal redondo: el producto cuyo diámetro se lee. */
const RE_TUBO =
  /(?:^|[^0-9a-z])(?:canos?|tubos?|corrugad[oa]s?|(?:cablecanal|cable canal|canaleta)s? redond[oa]s?)(?![0-9a-z])/
/** Accesorios de caño: con la palabra de caño/tubo, o sin ella sólo si el diámetro viene marcado ("ø25"). */
const RE_ACCESORIO_TUBO = /(?:^|[^0-9a-z])(?:conector(?:es)?|union(?:es)?|curvas?|grampas?|cuplas?|codos?|boquillas?)(?![0-9a-z])/
/** Lo que lleva "tubo" o "mm" pero no es un caño con diámetro: luces, herramientas, conductores, perfiles, medidas en cm. */
const NO_DIAMETRO =
  /(?:^|[^0-9a-z])(?:leds?|vidrio|nano|estanco|liston|fluorescentes?|lamparas?|llaves?|hexagonal(?:es)?|kits?|mangueras?|abrazaderas?|conductor(?:es)?|empalmes?|perfil(?:es)?|cuadrad[oa]s?|rectangulares?|colgantes?|tijeras?|alargador(?:es)?)(?![0-9a-z])|\d ?(?:w|watts?|cm)(?![0-9a-z])|mm ?2|mm²/
const NUM_DIAMETRO = "\\d{1,3}(?:[.,]\\d+)?"
/** "ø25", "Ø 25mm", "diámetro 25", "D:50mm": el diámetro dicho explícito. */
const RE_DIAMETRO_EXPLICITO = new RegExp(
  `(?:^|[^0-9a-z])(?:[øǿ⌀]|(?:diametro|diam)\\.? ?:?|d ?:) ?(${NUM_DIAMETRO})(?: ?mm)?(?![0-9a-z²³.,])`,
  "g",
)
/**
 * "25mm" suelto, sin ser una dimensión ("20 x 10mm"), un espesor ("esp 1,5mm"), una sección ("mm2") ni la
 * segunda de dos medidas ("para caño 20/25 mm": sirve para los dos, no es UN diámetro).
 */
const RE_DIAMETRO_PLANO = new RegExp(
  `(?<![0-9a-z.,/])(?<!\\d ?[x×] ?)(?<!esp(?:esor)?\\.? ?:? ?)(${NUM_DIAMETRO}) ?mm(?![0-9a-z²³])(?! ?[x×] ?\\d)`,
  "g",
)

/**
 * Accesorio de caño que ES el producto (primera palabra del nombre) aunque no diga "caño": "Grampa abierta a
 * presión 20 mm", "Unión rígida IP44 40 mm", "Cupla 3/4". El conector no entra (los hay de tiras, de empalme,
 * de datos) y tampoco lo neumático, lo roscado ni las piezas de bandeja ("CUPLA PERFIL C", "CURVA PLANA").
 */
const RE_ACCESORIO_CANO_INICIAL = /^(?:curvas?|union(?:es)?|grampas?|cuplas?|codos?|boquillas?)(?![0-9a-z])/
const NO_ACCESORIO_CANO =
  /(?:^|[^0-9a-z])(?:aire|neumatic[oa]s?|rosca|roscad[oa]s?|rapid[oa]s?|tiras?|perfil|ala|plana|articulad[oa]s?)(?![0-9a-z])/
/** Diámetros de la serie métrica de caño eléctrico (IEC 61386), en mm: sin la palabra caño sólo se aceptan estos. */
const SERIE_DIAMETRO_CANO = new Set([16, 20, 22, 25, 32, 40, 50, 63])
/**
 * Designación comercial en pulgadas del caño eléctrico → diámetro nominal de la serie métrica (aproximado:
 * es la equivalencia del mostrador, no la medida exterior de un caño de agua o gas):
 * 5/8" → 16, 3/4" → 20, 7/8" → 22, 1" → 25, 1 1/4" → 32, 1 1/2" → 40, 2" → 50.
 * 1/2" y 1/4" no: en caño eléctrico no hay equivalencia única (son medidas de rosca, tuercas y niples).
 */
const PULGADAS_CANO: Record<string, number> = { "5/8": 16, "3/4": 20, "7/8": 22, "1": 25, "1 1/4": 32, "1 1/2": 40, "2": 50 }
const MARCA_PULGADA = `(?:"|''|”|pulgadas?|pulg\\.?)`
/** Fracciones con o sin comillas ("3/4", "1 1/4\""); los enteros (1, 2) sólo con la marca de pulgada ("1\""). */
const RE_PULGADAS = new RegExp(
  `(?<![0-9a-z.,/-])(?:(1[ -]1/[24]|5/8|3/4|7/8)(?: ?${MARCA_PULGADA})?|([12]) ?${MARCA_PULGADA})(?![0-9a-z/.,])`,
  "g",
)
const pulgadasEnMm = (t: string): number[] =>
  [...t.matchAll(RE_PULGADAS)].map((m) => PULGADAS_CANO[(m[1] ?? m[2]).replace("-", " ")] ?? NaN)

/** Diámetro en mm de un caño, tubo o accesorio de caño según el NOMBRE; null si dudoso. */
export function diametroDeNombre(nombre: string): number | null {
  const t = normalizar(nombre ?? "").replace(/\s+/g, " ").trim()
  if (!t || NO_DIAMETRO.test(t)) return null
  const explicitos = [...t.matchAll(RE_DIAMETRO_EXPLICITO)].map((m) => numero(m[1]))
  const accesorio = RE_ACCESORIO_CANO_INICIAL.test(t) && !NO_ACCESORIO_CANO.test(t)
  if (RE_TUBO.test(t) || (RE_ACCESORIO_TUBO.test(t) && explicitos.length > 0)) {
    const crudos = explicitos.length > 0 ? explicitos : [...t.matchAll(RE_DIAMETRO_PLANO)].map((m) => numero(m[1]))
    // "Curva para caño 3/4": sin mm, la pulgada del accesorio.
    if (crudos.length === 0 && accesorio) return deLaSerie(pulgadasEnMm(t))
    return enRango("diametro_mm", unico(crudos.filter((n) => enRango("diametro_mm", n) != null)))
  }
  if (!accesorio) return null
  return deLaSerie([...[...t.matchAll(RE_DIAMETRO_PLANO)].map((m) => numero(m[1])), ...pulgadasEnMm(t)])
}

/** El único valor si TODOS son de la serie de caño eléctrico; si no, null (un "12mm" o un "1/2" no se adivinan). */
function deLaSerie(valores: number[]): number | null {
  return valores.every((v) => SERIE_DIAMETRO_CANO.has(v)) ? unico(valores) : null
}

/** Bandeja portacables (y sus tapas y accesorios: "TAPA BANDEJA", "TEE BANDEJA"). */
const RE_BANDEJA = /(?:^|[^0-9a-z])bandejas?(?![0-9a-z])/
/** "Articulada" sin la palabra bandeja ("CURVA ARTICULADA 250/50"): sólo con el par ancho/alto y un ancho de la serie. */
const RE_ARTICULADA = /(?:^|[^0-9a-z])articulad[oa]s?(?![0-9a-z])/
const NO_BANDEJA =
  /(?:^|[^0-9a-z])(?:magnetic[oa]s?|pintura|rodillo|horno|cocina|desayuno|asado|parrilla|escritorio|organizador|cubiertos|herramientas?|lamparas?|brazos?|leds?|soportes?|rack)(?![0-9a-z])|\d ?(?:w|watts?|v|u)(?![0-9a-z])|19 ?(?:"|pulgadas?)|(?:^|[^0-9a-z])p\. ?\d/
/** Anchos comerciales de bandeja portacables, en mm. */
const ANCHOS_BANDEJA = new Set([50, 75, 100, 150, 200, 250, 300, 400, 450, 500, 600])
/** Alturas de ala comerciales de bandeja portacables, en mm (el "50" de "300/50"). */
const ALTOS_BANDEJA = new Set([25, 35, 50, 64, 75, 92, 100])
/** "100/50": ancho/alto. Un "1200/5A" (relación de transformador) no entra: la unidad pegada lo descarta. */
const RE_ANCHO_ALTO = /(?<![0-9a-z.,/])(\d{2,4}) ?\/ ?(\d{2,3})(?![0-9a-z/.,])/g
const RE_ANCHO_SUELTO = /(?<![0-9a-z.,/-])(\d{2,4})(?: ?mm)?(?![0-9a-z²/.,-])/g
/**
 * Pieza de bandeja que ES el producto (primera palabra) aunque no diga "bandeja": "CURVA 45º 300/50", "TEE
 * 200/50", "CRUZ", "REDUCCION", "D. PARALELA", "PIEZA R. CENTRAL", "ACOMETIDA A TABLERO". Sólo con el par
 * ancho/ala y los dos de la serie: así no entran "230/400 V", "1200/5A" ni la caja "para caño 20/25 mm".
 */
const RE_ACCESORIO_BANDEJA_INICIAL =
  /^(?:curvas?|tees?|te|cruz|cruces|reduccion(?:es)?|union(?:es)?|derivacion(?:es)?|d\. ?(?:paralela|perpendicular)|desvios?|pieza r\.|r\. ?(?:central|lateral|simple)|acometida)(?![0-9a-z])/

/** Ancho en mm de una bandeja portacables (o su tapa o accesorio) según el NOMBRE; null si dudoso. */
export function anchoDeNombre(nombre: string): number | null {
  const t = normalizar(nombre ?? "").replace(/\s+/g, " ").trim()
  if (!t || NO_BANDEJA.test(t)) return null
  const paresConAlto = [...t.matchAll(RE_ANCHO_ALTO)].map((m) => [Number(m[1]), Number(m[2])] as const)
  const pares = paresConAlto.map(([ancho]) => ancho)
  if (RE_BANDEJA.test(t)) {
    const crudos = pares.length > 0 ? pares : [...t.matchAll(RE_ANCHO_SUELTO)].map((m) => Number(m[1]))
    return enRango("ancho_mm", unico(crudos.filter((n) => enRango("ancho_mm", n) != null)))
  }
  if (RE_ARTICULADA.test(t)) return enRango("ancho_mm", unico(pares.filter((n) => ANCHOS_BANDEJA.has(n))))
  if (RE_ACCESORIO_BANDEJA_INICIAL.test(t)) {
    const deSerie = paresConAlto.every(([ancho, alto]) => ANCHOS_BANDEJA.has(ancho) && ALTOS_BANDEJA.has(alto))
    return deSerie ? enRango("ancho_mm", unico(pares)) : null
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// dimerizable (0072). Texto "si"/"no". Se lee del nombre y de la descripción (es una palabra del producto,
// no una medida), pero sólo si el producto ES lo que se regula (lámpara, panel, tira, driver, luminaria):
// un dimmer, una tecla, un variador o un sensor "dimerizan", no "son dimerizables".
// ---------------------------------------------------------------------------------------------

/** "dimerizable", "dimeable", "dimmable", "dimmerizable", "dimmeable" (singular: en plural suele ser "para lámparas dimerizables"). */
const RE_DIMERIZABLE = /(?<![a-z])dim{1,2}(?:er(?:iz)?|e)?able(?![a-z])/g
const RE_TRIAC_DIM = /(?<![a-z])triac dim(?![a-z])/g
/**
 * La sigla "DIM" / "NO DIM" de los nombres de lámparas ("AR111 15W GU10 DIM", "DICROICA 7W NO DIM"). Sólo del NOMBRE y sólo en
 * un producto con señal de lámpara (potencia en W, tensión AC o un zócalo): "DIM" suelto en otro rubro suele ser "dimensión".
 */
const RE_SIGLA_DIM = /(?<![a-z0-9])(no )?dim(?![a-z0-9.])(?! ?\d+(?:[.,]\d+)? ?[x×*])/g
const RE_SENAL_LAMPARA = /(?<![a-z0-9.,])\d+(?:[.,]\d+)? ?w(?![a-z0-9])|(?<![a-z])ac ?\d|(?<![a-z0-9])(?:gu10|gu5\.3|e27|e14|mr16|g9|g4)(?![a-z0-9])/
/** Lo que regula a otro, no lo regulado: el nombre del producto dice que es un dimmer o un mando. */
const RE_ES_DIMMER =
  /(?:^|[^a-z])(?:dimm?ers?|regulador(?:es)?|variador(?:es)?)(?![a-z])|^(?:\d+ )?(?:teclas?|llaves?|interruptor(?:es)?|pulsador(?:es)?|sensor(?:es)?|controlador(?:es)?|control|modulo|selector(?:es)?|kit)(?![a-z])/
/** Negación pegada antes de la palabra: "NO DIMERIZABLE", "no es dimeable", "sin dimmer". */
const RE_NEGADO = /(?:^|[^a-z])(?:no|non|sin|ni)(?: es| son)?[ -]?$/
/** "para lámparas dimerizables", "compatible con dimmer": el dato es de otra cosa, no del producto. */
const RE_PARA_OTRO = /(?:^|[^a-z])(?:para|p\/|compatibles? con|aptos? para|aptas? para)(?: \w+){0,2} ?$/

/** Sí/no del nombre (+ descripción) según su familia; null si no lo dice, es un dimmer o hay contradicción. */
export function dimerizableDeTexto(nombre: string, descripcion?: string | null): Dimerizable | null {
  const n = normalizar(nombre ?? "").replace(/\s+/g, " ").trim()
  const t = normalizar(`${nombre ?? ""} ${descripcion ?? ""}`).replace(/\s+/g, " ").trim()
  if (!t || RE_ES_DIMMER.test(n)) return null
  const hallados: Dimerizable[] = []
  for (const re of [RE_DIMERIZABLE, RE_TRIAC_DIM]) {
    for (const m of t.matchAll(re)) {
      const antes = t.slice(Math.max(0, m.index - 24), m.index)
      if (RE_PARA_OTRO.test(antes)) continue
      hallados.push(RE_NEGADO.test(antes) ? "no" : "si")
    }
  }
  if (RE_SENAL_LAMPARA.test(n)) {
    for (const m of n.matchAll(RE_SIGLA_DIM)) {
      const antes = n.slice(Math.max(0, m.index - 24), m.index)
      if (RE_PARA_OTRO.test(antes)) continue
      hallados.push(m[1] || RE_NEGADO.test(antes) ? "no" : "si")
    }
  }
  return unico(hallados)
}

// ---------------------------------------------------------------------------------------------
// modulos (0072). Capacidad en módulos DIN (18 mm) de un gabinete, caja o tablero: lo que decide la compra de la envolvente
// ("tablero de 12 bocas"). Sólo del producto que ES la envolvente (su nombre empieza con caja/gabinete/tablero):
// un contrafrente, una tapa, un riel o un caballete "p/12 polos" son accesorios. Los "módulos" de bastidor de una caja de
// mecanismos (teclas y tomas: "Caja Stik 2 módulos") son otra unidad y no se leen; tampoco los polos de una bornera o un seccionador.
// ---------------------------------------------------------------------------------------------

const RE_ENVOLVENTE_DIN = /^(?:\d+ )?(?:cajas?|gabinetes?|gab\.?|tableros?|envolventes?)(?![0-9a-z])/
/** "12 Mod DIN", "p/ 4 mód. DIN", "8 modulos DIN": módulos con la palabra DIN. */
const RE_MOD_DIN = /(?<![0-9a-z.,])(\d{1,3}) ?(?:modulos?|mods?)\.? ?din(?![a-z])/g
/** "12 polos" (también "p/12 polos DIN" y "96 P." de algunos gabinetes estancos) de una caja o gabinete: capacidad en polos = módulos. */
const RE_POLOS_CAJA = /(?<![0-9a-z.,])(\d{1,3}) ?(?:polos?(?![a-z])|p\.(?![a-z]))/g
const RE_BOCAS = /(?<![0-9a-z.,])(\d{1,3}) ?bocas?(?![a-z])/g
/** "2 módulos" de una caja para térmicas: sólo con contexto DIN (térmicas, pilar/pilastra, DIN, IP65). */
const RE_MODULOS_SUELTO = /(?<![0-9a-z.,x×/-])(\d{1,3}) ?modulos?(?![a-z])/g
const RE_CONTEXTO_DIN = /(?<![a-z])(?:din|termicas?|pilar|pilastra|ip ?65)(?![a-z])/

/** Módulos DIN de un gabinete, caja o tablero según el nombre (+ descripción); null si dudoso. */
export function modulosDeNombre(nombre: string, descripcion?: string | null): number | null {
  const n = normalizar(nombre ?? "").replace(/\s+/g, " ").trim()
  if (!RE_ENVOLVENTE_DIN.test(n)) return null
  const t = normalizar(`${nombre ?? ""} ${descripcion ?? ""}`).replace(/\s+/g, " ").trim()
  const valores = (re: RegExp) => [...t.matchAll(re)].map((m) => Number(m[1]))
  const primeros = [...valores(RE_MOD_DIN), ...valores(RE_POLOS_CAJA)]
  const crudos =
    primeros.length > 0
      ? primeros
      : valores(RE_BOCAS).length > 0
        ? valores(RE_BOCAS)
        : RE_CONTEXTO_DIN.test(t)
          ? valores(RE_MODULOS_SUELTO)
          : []
  return enRango("modulos", unico(crudos))
}

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

  out.push(...extraerAmpliadas(t, normalizar(nombre ?? "").replace(/\s+/g, " ").trim()))
  num("diametro_mm", diametroDeNombre(nombre))
  num("ancho_mm", anchoDeNombre(nombre))
  const dimerizable = dimerizableDeTexto(nombre, descripcion)
  if (dimerizable) out.push({ clave: "dimerizable", valorNum: null, valorTexto: dimerizable })
  num("modulos", modulosDeNombre(nombre, descripcion))

  const fuera = clavesDescartadasPorNombre(nombre)
  const orden = (c: ClaveAtributo) => CLAVES_ATRIBUTO.indexOf(c)
  return out.filter((a) => !fuera.has(a.clave)).sort((a, b) => orden(a.clave) - orden(b.clave))
}

/** Rango de regulación en texto: "4-6", "1.6-2.5 A", "0,63 – 1". */
const RE_RANGO_CORRIENTE = /^\s*(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*(?:a)?\s*$/i

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
    } else if (clave === "dimerizable") {
      const di = dimerizableValido(v)
      if (di) out.push({ clave, valorNum: null, valorTexto: di })
    } else if (clave === "curva") {
      const cu = curvaValida(v)
      if (cu) out.push({ clave, valorNum: null, valorTexto: cu })
    } else if (clave === "medidas_mm") {
      const me = medidasValidas(v)
      if (me) out.push({ clave, valorNum: null, valorTexto: me })
    } else if (clave === "corriente_a" && typeof v === "string" && RE_RANGO_CORRIENTE.test(v)) {
      // Rango de regulación de un relé térmico o un guardamotor ("4-6", "1,6-2,5 A"): texto canónico con punto
      // decimal y, como número, el tope.
      const m = RE_RANGO_CORRIENTE.exec(v)!
      const [a, b] = [enRango(clave, numero(m[1])), enRango(clave, numero(m[2]))]
      if (a != null && b != null && a < b) out.push({ clave, valorNum: b, valorTexto: `${a}-${b}` })
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
