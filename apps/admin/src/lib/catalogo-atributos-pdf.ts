/**
 * Lectura de la ficha técnica (PDF) de un producto con Claude Haiku, para `catalog_atributos` con
 * `fuente = 'pdf'` (catálogo asistido fase 2, subproyecto 5). A PEDIDO desde el admin, nunca
 * masivo: el script de lote (`scripts/leer-fichas-catalogo.ts`) sólo estima el costo por defecto.
 *
 * Llama a la Messages API por HTTP (`fetch`): el admin no tiene `@anthropic-ai/sdk` como dependencia
 * y sumarla sólo para esto no se justifica. SOLO servidor: usa `ANTHROPIC_API_KEY`.
 *
 * Salida CERRADA: el modelo está obligado a llamar a una herramienta cuyo esquema tiene exactamente
 * las dieciocho claves de `CLAVES_ATRIBUTO` (cada una número/texto o null). Aun así la respuesta se
 * valida del lado nuestro (`normalizarAtributos`): claves desconocidas, rangos imposibles y basura
 * se descartan. Lo que el PDF no dice queda afuera (null ⇒ no se escribe).
 */
import { CLAVES_ATRIBUTO, DEFINICION_ATRIBUTOS, normalizarAtributos, type AtributoExtraido, type ClaveAtributo } from "./catalogo-atributos-extraccion"

export const MODELO_FICHA = "claude-haiku-4-5"
const URL_API = "https://api.anthropic.com/v1/messages"
const VERSION_API = "2023-06-01"
const MAX_TOKENS = 1024
const NOMBRE_HERRAMIENTA = "registrar_atributos"

/** Precios de Claude Haiku 4.5 por millón de tokens (USD), para estimar el lote. */
export const PRECIO_HAIKU_POR_MTOK = { entrada: 1, salida: 5 } as const
/**
 * Heurística para estimar sin leer los PDFs: tokens por página de una ficha (texto + imagen de la
 * página, que es como la API procesa un PDF) y tokens de salida por lectura (una llamada a la
 * herramienta con dieciocho campos). Conservadora: sobreestima.
 */
export const TOKENS_POR_PAGINA = 3000
export const TOKENS_SALIDA_POR_FICHA = 300
/** Prompt de sistema + definición de la herramienta (18 claves con su descripción). */
const TOKENS_PROMPT = 1600

/** Texto que lee el modelo para cada clave (una línea por clave; vive acá y no en el módulo del panel). */
export const DESCRIPCION_PDF: Record<ClaveAtributo, string> = {
  potencia_w: "Potencia nominal en watts (número). Si hay varias variantes, null.",
  temperatura_k: "Temperatura de color en kelvin (número, p. ej. 3000). Si es regulable o hay varias, null.",
  tono:
    'Tipo de luz: "calido", "neutro" o "frio" (luz blanca), o el color de la luz: "rojo", "verde", "azul", "amarillo", "naranja", "ambar", "violeta" o "rosa" (p. ej. "Tipo de luz: Verde"), o "rgb" / "rgbw". null si no aplica o no se indica. No es el color del producto.',
  ip: "Grado de protección IP como número de dos cifras (IP65 → 65). null si no se indica.",
  flujo_lm: "Flujo luminoso en lúmenes (número).",
  tension_v: 'Tensión de alimentación: un número ("220") o un rango ("85-265"). null si no se indica.',
  zocalo: 'Zócalo o base de la lámpara ("E27", "GU10", "G9"…). null si no tiene.',
  corriente_a:
    'Corriente nominal en amperes ("25"). En un relé térmico o un guardamotor, el rango de regulación ("4-6", "1.6-2.5"). No poner sensibilidad en mA ni poder de corte en kA.',
  polos: "Cantidad de polos, entero de 1 a 4.",
  seccion_mm2: "Sección del conductor en mm2 (número), no la cantidad de conductores.",
  medidas_mm: 'Dimensiones externas en mm como "AxB" o "AxBxC" (p. ej. "300x1200"); null si no hay.',
  color:
    "Color del cuerpo o carcasa del producto (no el de la luz): blanco, negro, gris, rojo, azul, verde, amarillo, marron, naranja, transparente, plateado o dorado. La luz blanca/cálida/fría NO es color.",
  poder_corte_ka: "Poder de corte en kA (número).",
  curva: 'Curva de disparo: "B", "C" o "D".',
  sensibilidad_ma: "Sensibilidad diferencial en mA (número), p. ej. 30.",
  largo_m: "Largo en metros (número) de cable, rollo, tira o tubo.",
  montaje: 'Tipo de montaje: "embutir", "aplicar", "colgante", "riel" o "din".',
  angulo_grados: "Ángulo de apertura o haz en grados (número).",
  leds_m:
    'Cantidad de LED por metro de una tira o manguera (entero, p. ej. 60 o 120). SOLO si el texto lo dice por metro ("60 LED/m", "120 LEDs/m"); no la cantidad total de LED ni de un módulo.',
  potencia_w_m:
    'Potencia por metro de una tira o manguera en W/m (número, p. ej. 4.8 o 14.4). SOLO si el texto la da por metro ("14.4 W/m"); la potencia total va en potencia_w, nunca acá.',
  leds_rollo:
    'Cantidad TOTAL de LED del rollo o tira (entero, p. ej. 300 o 600), no por metro. Va acá si el texto da el total del rollo ("300 LED", "300 LEDs"); si lo da por metro ("60 LED/m") va en leds_m.',
  diametro_mm:
    'Diámetro en milímetros (número, p. ej. 20 o 32) de un caño, tubo, conector, unión, curva, grampa de caño o cablecanal redondo. SOLO el diámetro exterior o nominal del caño; no la sección de un cable ni un espesor.',
  ancho_mm:
    'Ancho en milímetros (entero, p. ej. 100 o 300) de una bandeja portacables o de su tapa o accesorio. SOLO el ancho (el primer número de "100/50"); no el alto ni el largo.',
}

/**
 * Tipo JSON de cada campo en la herramienta: el de `DEFINICION_ATRIBUTOS`, salvo la tensión y la corriente, que el
 * modelo puede devolver como rango de texto ("85-265", "4-6").
 */
const tipoDeCampo = (c: ClaveAtributo) =>
  DEFINICION_ATRIBUTOS[c].tipo === "num" && c !== "tension_v" && c !== "corriente_a" ? "number" : "string"

/** Propiedades del esquema, armadas desde `CLAVES_ATRIBUTO`: nunca queda desfasado de la base. */
const PROPIEDADES = Object.fromEntries(
  CLAVES_ATRIBUTO.map((c) => [c, { type: [tipoDeCampo(c), "null"] as [string, "null"], description: DESCRIPCION_PDF[c] }]),
) as Record<ClaveAtributo, { type: [string, "null"]; description: string }>

/** Esquema cerrado de la salida: las mismas claves que `catalog_atributos`, todas requeridas (o null). */
export const HERRAMIENTA_ATRIBUTOS = {
  name: NOMBRE_HERRAMIENTA,
  description:
    "Registra los datos técnicos del producto leídos de su ficha técnica. Cada campo va null si la ficha no lo dice explícitamente.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [...CLAVES_ATRIBUTO] as ClaveAtributo[],
    properties: PROPIEDADES,
  },
} as const

const INSTRUCCIONES =
  "Sos un asistente que extrae datos técnicos de fichas de productos eléctricos y de iluminación. " +
  "Leé el PDF adjunto y llamá a la herramienta registrar_atributos con los valores que la ficha dice " +
  "explícitamente para este producto. No infieras ni completes: si un dato no está, o la ficha cubre " +
  "varias variantes y no se puede saber cuál es este producto, ese campo va null."

/** Cuerpo del pedido a la Messages API (puro, para testear). */
export function pedidoLecturaFicha(pdf: Uint8Array, nombreProducto: string) {
  return {
    model: MODELO_FICHA,
    max_tokens: MAX_TOKENS,
    system: INSTRUCCIONES,
    tools: [HERRAMIENTA_ATRIBUTOS],
    tool_choice: { type: "tool", name: NOMBRE_HERRAMIENTA },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") } },
          { type: "text", text: `Producto: ${nombreProducto.slice(0, 300)}` },
        ],
      },
    ],
  }
}

export class ErrorLecturaFicha extends Error {
  constructor(
    message: string,
    /** Mensaje para el operador (usted). */
    readonly paraUsuario: string,
    readonly estado?: number,
  ) {
    super(message)
    this.name = "ErrorLecturaFicha"
  }
}

export interface ResultadoLectura {
  atributos: AtributoExtraido[]
  uso: { entrada: number; salida: number }
}

/** Respuesta de la Messages API → atributos válidos. Tira `ErrorLecturaFicha` si no hay tool_use. */
export function interpretarRespuesta(json: unknown): ResultadoLectura {
  const r = json as {
    stop_reason?: string
    content?: { type?: string; name?: string; input?: unknown }[]
    usage?: { input_tokens?: number; output_tokens?: number }
  } | null
  const bloque = r?.content?.find((b) => b?.type === "tool_use" && b.name === NOMBRE_HERRAMIENTA)
  if (!bloque) {
    throw new ErrorLecturaFicha(
      `sin tool_use (stop_reason=${r?.stop_reason ?? "?"})`,
      "No se pudieron leer datos de la ficha técnica. Inténtelo de nuevo o cargue los valores a mano.",
    )
  }
  return {
    atributos: normalizarAtributos(bloque.input),
    uso: { entrada: Number(r?.usage?.input_tokens ?? 0), salida: Number(r?.usage?.output_tokens ?? 0) },
  }
}

export interface DepsLectura {
  fetch?: typeof fetch
  apiKey?: string
}

/** ¿Está configurada la lectura de fichas? (sin clave el botón responde 503). */
export function lecturaFichaConfigurada(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim())
}

/** Manda el PDF a Claude Haiku y devuelve los atributos leídos (ya normalizados). */
export async function leerFichaPdf(pdf: Uint8Array, nombreProducto: string, deps: DepsLectura = {}): Promise<ResultadoLectura> {
  const apiKey = (deps.apiKey ?? process.env.ANTHROPIC_API_KEY)?.trim()
  if (!apiKey) {
    throw new ErrorLecturaFicha("sin ANTHROPIC_API_KEY", "La lectura de fichas técnicas no está configurada. Avise al administrador.", 503)
  }
  const f = deps.fetch ?? fetch
  let res: Response
  try {
    res = await f(URL_API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": VERSION_API },
      body: JSON.stringify(pedidoLecturaFicha(pdf, nombreProducto)),
      signal: AbortSignal.timeout(50_000),
    })
  } catch (err) {
    throw new ErrorLecturaFicha(
      `red: ${err instanceof Error ? err.name : "error"}`,
      "No se pudo contactar al servicio de lectura. Inténtelo de nuevo en unos minutos.",
      502,
    )
  }
  if (!res.ok) {
    // El cuerpo del error de la API no se reenvía al navegador (puede traer detalles internos).
    const reintentable = res.status === 429 || res.status >= 500
    throw new ErrorLecturaFicha(
      `api ${res.status}`,
      reintentable
        ? "El servicio de lectura está ocupado. Inténtelo de nuevo en unos minutos."
        : "La ficha técnica no se pudo procesar (¿es un PDF válido de menos de 100 páginas?).",
      502,
    )
  }
  return interpretarRespuesta(await res.json())
}

/** Costo estimado en USD de leer `fichas` PDFs de `paginasPromedio` páginas (para el lote). */
export function estimarCostoLote(fichas: number, paginasPromedio: number): { tokensEntrada: number; tokensSalida: number; usd: number } {
  const tokensEntrada = Math.round(fichas * (paginasPromedio * TOKENS_POR_PAGINA + TOKENS_PROMPT))
  const tokensSalida = fichas * TOKENS_SALIDA_POR_FICHA
  const usd = (tokensEntrada * PRECIO_HAIKU_POR_MTOK.entrada + tokensSalida * PRECIO_HAIKU_POR_MTOK.salida) / 1_000_000
  return { tokensEntrada, tokensSalida, usd: Math.round(usd * 100) / 100 }
}
