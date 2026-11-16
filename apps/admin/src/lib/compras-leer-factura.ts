/**
 * Lectura de la factura (o remito) de un proveedor en PDF para prellenar «Nueva compra».
 *
 * Barato a propósito: el texto del PDF se extrae LOCAL con `unpdf` (gratis) y al modelo sólo viaja
 * ese texto, no el PDF (que la API procesa como imagen por página y cuesta mucho más). Un PDF
 * escaneado no tiene texto: se rechaza y se carga a mano.
 *
 * El modelo (Claude Haiku) está obligado a llamar a una herramienta de esquema cerrado; la respuesta
 * se normaliza de nuestro lado y NADA se escribe en Alegra: el resultado sólo completa el formulario,
 * que el usuario revisa antes de «Registrar compra». Los controles numéricos (Σ líneas vs subtotal)
 * los hace el código, no el modelo.
 *
 * Llama a la Messages API por HTTP, como `catalogo-atributos-pdf.ts`. SOLO servidor: `ANTHROPIC_API_KEY`.
 */

export const MODELO_FACTURA = "claude-haiku-4-5"
const URL_API = "https://api.anthropic.com/v1/messages"
const VERSION_API = "2023-06-01"
const MAX_TOKENS = 8000
const NOMBRE_HERRAMIENTA = "registrar_factura"
/** Tope de texto que se manda al modelo (una factura larga ronda los 10–20 mil caracteres). */
export const MAX_CARACTERES = 60_000

const numONull = (description: string) => ({ type: ["number", "null"], description })
const textoONull = (description: string) => ({ type: ["string", "null"], description })

export const HERRAMIENTA_FACTURA = {
  name: NOMBRE_HERRAMIENTA,
  description: "Registra los datos de la factura o remito de compra leídos del texto del documento.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "tipo_documento",
      "cuit_emisor",
      "razon_social_emisor",
      "numero_factura",
      "fecha",
      "vencimiento",
      "descuento_general_pct",
      "lineas",
      "percepciones",
      "subtotal_neto",
      "total",
    ],
    properties: {
      tipo_documento: { type: "string", enum: ["factura", "remito", "otro"], description: "Qué documento es." },
      cuit_emisor: textoONull(
        "CUIT del EMISOR (el proveedor que vende). NUNCA el CUIT del cliente o receptor. null si el documento no lo muestra.",
      ),
      razon_social_emisor: textoONull("Razón social del EMISOR (el proveedor). Nunca la del cliente. null si no figura."),
      numero_factura: textoONull(
        'Número de la factura como "PPPPP-NNNNNNNN" (punto de venta y número). null si el documento NO es una factura (p. ej. un remito).',
      ),
      fecha: textoONull("Fecha de emisión en formato YYYY-MM-DD. Las fechas del documento son día/mes/año."),
      vencimiento: textoONull("Fecha de vencimiento en formato YYYY-MM-DD, o null si no figura."),
      descuento_general_pct: numONull(
        "Descuento o bonificación GENERAL sobre el subtotal, en porcentaje (p. ej. 40 si el subtotal 1000 tiene un descuento de -400). null si no hay. Un recargo va negativo.",
      ),
      lineas: {
        type: "array",
        description: "Una entrada por renglón de producto, en el orden del documento.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["codigo", "descripcion", "cantidad", "precio_unitario", "iva_pct"],
          properties: {
            codigo: textoONull("Código del artículo tal como figura, o null."),
            descripcion: { type: "string", description: "Descripción del renglón." },
            cantidad: { type: "number", description: "Cantidad (número; 15.00 → 15)." },
            precio_unitario: {
              type: "number",
              description:
                "Precio unitario SIN IVA, con la bonificación propia del renglón ya aplicada si la tiene, y SIN aplicar el descuento general. Si el documento muestra precios con IVA incluido, dividilo por (1 + IVA).",
            },
            iva_pct: numONull("Alícuota de IVA del renglón (21, 10.5, 27 o 0). null si no se indica por renglón."),
          },
        },
      },
      percepciones: {
        type: "array",
        description: "Percepciones (IIBB, IVA, etc.) que suma la factura. Vacío si no hay.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["descripcion", "importe"],
          properties: {
            descripcion: { type: "string" },
            importe: { type: "number" },
          },
        },
      },
      subtotal_neto: numONull("Subtotal neto gravado (sin IVA, ya con el descuento general aplicado), o null."),
      total: numONull("Total del documento, o null."),
    },
  },
} as const

const INSTRUCCIONES =
  "Sos un asistente que extrae los datos de facturas y remitos de proveedores argentinos de materiales eléctricos e iluminación. " +
  "Recibís el texto extraído de un PDF (puede venir desordenado por columnas). Llamá a la herramienta registrar_factura con lo que el " +
  "documento dice explícitamente. Los números usan formatos mixtos: interpretalos por contexto (\"1105,280.00\" = 1105280; \"8150,576.50\" = 8150576.5). " +
  "Distinguí al emisor (quien vende) del cliente (quien compra). No inventes: si un dato no está, va null."

/** Cuerpo del pedido a la Messages API (puro, para testear). */
export function pedidoLecturaFactura(texto: string) {
  return {
    model: MODELO_FACTURA,
    max_tokens: MAX_TOKENS,
    system: INSTRUCCIONES,
    tools: [HERRAMIENTA_FACTURA],
    tool_choice: { type: "tool", name: NOMBRE_HERRAMIENTA },
    messages: [{ role: "user", content: [{ type: "text", text: `Texto del documento:\n\n${texto.slice(0, MAX_CARACTERES)}` }] }],
  }
}

export class ErrorLecturaFactura extends Error {
  constructor(
    message: string,
    /** Mensaje para el usuario (usted). */
    readonly paraUsuario: string,
    readonly estado = 502,
  ) {
    super(message)
    this.name = "ErrorLecturaFactura"
  }
}

export interface LineaLeida {
  codigo: string | null
  descripcion: string
  cantidad: number
  /** Costo unitario neto con el descuento general ya repartido (2 decimales). */
  costo: number
  ivaPct: number | null
}

export interface FacturaLeida {
  tipoDocumento: "factura" | "remito" | "otro"
  cuitEmisor: string | null
  razonSocialEmisor: string | null
  numeroFactura: string | null
  fecha: string | null
  vencimiento: string | null
  descuentoGeneralPct: number | null
  lineas: LineaLeida[]
  percepciones: { descripcion: string; importe: number }[]
  subtotalNetoLeido: number | null
  totalLeido: number | null
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const fecha = (v: unknown) => {
  const t = texto(v)
  return t && FECHA.test(t) ? t : null
}
const redondear2 = (n: number) => Math.round(n * 100) / 100

/** Entrada de la herramienta → datos validados, con el descuento general repartido en cada costo. */
export function normalizarFactura(input: unknown): FacturaLeida {
  const r = (input ?? {}) as Record<string, unknown>
  const tipo = r.tipo_documento === "factura" || r.tipo_documento === "remito" ? r.tipo_documento : "otro"
  const dto = numero(r.descuento_general_pct)
  const factor = dto !== null && dto > -100 && dto < 100 ? 1 - dto / 100 : 1
  const lineas: LineaLeida[] = []
  for (const l of Array.isArray(r.lineas) ? r.lineas : []) {
    const x = (l ?? {}) as Record<string, unknown>
    const cantidad = numero(x.cantidad)
    const precio = numero(x.precio_unitario)
    if (cantidad === null || cantidad <= 0 || precio === null || precio < 0) continue
    lineas.push({
      codigo: texto(x.codigo),
      descripcion: texto(x.descripcion) ?? "",
      cantidad,
      costo: redondear2(precio * factor),
      ivaPct: numero(x.iva_pct),
    })
  }
  const percepciones = (Array.isArray(r.percepciones) ? r.percepciones : [])
    .map((p) => {
      const x = (p ?? {}) as Record<string, unknown>
      return { descripcion: texto(x.descripcion) ?? "", importe: numero(x.importe) ?? 0 }
    })
    .filter((p) => p.importe > 0)
  const cuit = texto(r.cuit_emisor)
  return {
    tipoDocumento: tipo,
    cuitEmisor: cuit,
    razonSocialEmisor: texto(r.razon_social_emisor),
    // Un remito no tiene número de factura: no se propone el suyo.
    numeroFactura: tipo === "factura" ? texto(r.numero_factura) : null,
    fecha: fecha(r.fecha),
    vencimiento: fecha(r.vencimiento),
    descuentoGeneralPct: dto,
    lineas,
    percepciones,
    subtotalNetoLeido: numero(r.subtotal_neto),
    totalLeido: numero(r.total),
  }
}

/** Neto calculado (Σ cantidad × costo) para compararlo con el subtotal leído. */
export const netoCalculado = (lineas: LineaLeida[]) => redondear2(lineas.reduce((a, l) => a + l.cantidad * l.costo, 0))

/** Respuesta de la Messages API → factura normalizada. */
export function interpretarRespuestaFactura(json: unknown): FacturaLeida {
  const r = json as { stop_reason?: string; content?: { type?: string; name?: string; input?: unknown }[] } | null
  const bloque = r?.content?.find((b) => b?.type === "tool_use" && b.name === NOMBRE_HERRAMIENTA)
  if (!bloque || r?.stop_reason === "max_tokens") {
    throw new ErrorLecturaFactura(
      `sin tool_use completo (stop_reason=${r?.stop_reason ?? "?"})`,
      "No se pudieron leer los datos del documento. Cargue la compra a mano.",
    )
  }
  return normalizarFactura(bloque.input)
}

export interface DepsLecturaFactura {
  fetch?: typeof fetch
  apiKey?: string
}

/** Manda el TEXTO del documento a Claude Haiku y devuelve la factura normalizada. */
export async function leerFacturaTexto(textoDoc: string, deps: DepsLecturaFactura = {}): Promise<FacturaLeida> {
  const apiKey = (deps.apiKey ?? process.env.ANTHROPIC_API_KEY)?.trim()
  if (!apiKey) {
    throw new ErrorLecturaFactura("sin ANTHROPIC_API_KEY", "La lectura de facturas no está configurada. Avise al administrador.", 503)
  }
  const f = deps.fetch ?? fetch
  let res: Response
  try {
    res = await f(URL_API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": VERSION_API },
      body: JSON.stringify(pedidoLecturaFactura(textoDoc)),
      signal: AbortSignal.timeout(55_000),
    })
  } catch (err) {
    throw new ErrorLecturaFactura(
      `red: ${err instanceof Error ? err.name : "error"}`,
      "No se pudo contactar al servicio de lectura. Inténtelo de nuevo en unos minutos.",
    )
  }
  if (!res.ok) {
    throw new ErrorLecturaFactura(`HTTP ${res.status}`, "El servicio de lectura no respondió. Inténtelo de nuevo en unos minutos.")
  }
  return interpretarRespuestaFactura(await res.json())
}

/** Sólo dígitos del CUIT (para buscarlo con o sin guiones). */
export const digitosCuit = (cuit: string) => cuit.replace(/\D/g, "")

/** CUIT con guiones (30-71581216-5) a partir de sus 11 dígitos; si no son 11, tal cual. */
export function cuitConGuiones(cuit: string): string {
  const d = digitosCuit(cuit)
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : cuit
}

/**
 * Elige el producto del catálogo para un código del proveedor: coincidencia exacta del código, o
 * única referencia `<código>-<marca>` (así se cargan los ítems: 3430 → 3430-TCM). Ambiguo ⇒ null.
 */
export function elegirProductoPorCodigo<T extends { codigo: string | null }>(codigo: string, candidatos: T[]): T | null {
  const c = codigo.trim().toUpperCase()
  if (!c) return null
  const exactos = candidatos.filter((p) => p.codigo?.trim().toUpperCase() === c)
  if (exactos.length === 1) return exactos[0]
  if (exactos.length > 1) return null
  const conMarca = candidatos.filter((p) => p.codigo?.trim().toUpperCase().startsWith(`${c}-`))
  return conMarca.length === 1 ? conMarca[0] : null
}

/**
 * Texto de una página armado por renglones a partir de los fragmentos con coordenadas de pdfjs.
 * `extractText` pega las celdas de una tabla sin separador ("586,395.0039,093.0015.00"): acá se
 * agrupan por altura (y) y se ordenan de izquierda a derecha, separadas por " | ".
 */
export function textoPorRenglones(items: { str: string; x: number; y: number; h: number }[]): string {
  const ordenados = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const renglones: { y: number; tol: number; partes: { x: number; str: string }[] }[] = []
  for (const it of ordenados) {
    const tol = Math.max(2, (it.h || 8) * 0.5)
    const r = renglones.find((x) => Math.abs(x.y - it.y) <= Math.max(tol, x.tol))
    if (r) r.partes.push({ x: it.x, str: it.str })
    else renglones.push({ y: it.y, tol, partes: [{ x: it.x, str: it.str }] })
  }
  return renglones
    .sort((a, b) => b.y - a.y)
    .map((r) =>
      r.partes
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str.trim())
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean)
    .join("\n")
}
