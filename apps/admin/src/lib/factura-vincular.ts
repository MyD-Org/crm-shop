import type { AlegraFacturaResumen } from "./alegra"

// "Vincular factura" (detalle de pedido del admin): lógica pura para decidir qué factura de
// Alegra corresponde a lo que tipeó el operador y si se puede vincular al pedido. Las lecturas
// de Alegra entran inyectadas (`deps`) para poder probarla sin red.

/** Segmentos alfanuméricos en mayúsculas, sin ceros a la izquierda en los numéricos. */
function segmentos(s: string): string[] {
  return s
    .toUpperCase()
    .split(/[^0-9A-Z]+/)
    .filter(Boolean)
    .map((x) => (/^\d+$/.test(x) ? x.replace(/^0+(?=\d)/, "") : x))
}

/**
 * ¿El número legible de Alegra es el que tipeó el operador? Acepta el número completo como lo
 * muestra Alegra ("00201-00007040"), sin ceros a la izquierda ("201-7040"), sin guiones
 * ("0020100007040") o sólo la parte final ("7040"). Nunca un prefijo o un pedazo de segmento:
 * "704" no es "7040".
 */
export function numeroFacturaCoincide(numero: string | null, tipeado: string): boolean {
  if (!numero) return false
  const t = segmentos(tipeado)
  const n = segmentos(numero)
  if (t.length === 0) return false
  if (t.length <= n.length && n.slice(-t.length).every((seg, i) => seg === t[i])) return true
  const soloDigitos = (s: string) => s.replace(/\D/g, "")
  const dt = soloDigitos(tipeado)
  return dt.length > 0 && soloDigitos(numero) === dt
}

export type MotivoFacturaInvalida = "borrador" | "anulada" | "otro_cliente"

// ───────────────────────── Enlace de Alegra ─────────────────────────
//
// El operador puede tipear, en vez del número, el enlace que Alegra muestra en su propia UI
// ("https://app.alegra.com/invoice/view/id/2618"): un patrón conocido de la URL real del
// producto (no un dominio de cliente), así que se puede escribir literal acá y en los tests.
// Un enlace a OTRO tipo de documento (remito, cotización, nota de crédito…) se reconoce pero
// se rechaza con un error propio: no hay forma de "convertirlo" en factura.

const ALEGRA_DOC_URL_RE = /^https?:\/\/app\.alegra\.com\/([a-z-]+)\/view\/id\/(\d+)(?:[/?#]|$)/i

/** Nombre legible del tipo de documento de Alegra, para el mensaje de error. */
const ALEGRA_DOCUMENTOS: Record<string, string> = {
  remission: "un remito",
  estimate: "una cotización",
  "credit-note": "una nota de crédito",
  "debit-note": "una nota de débito",
  "purchase-order": "una orden de compra",
  bill: "un gasto",
}

export type UrlAlegraParseada = { tipo: "invoice"; id: string } | { tipo: "otro"; documento: string }

/**
 * Si `tipeado` es un enlace de Alegra a un documento (`.../<documento>/view/id/<id>`), lo
 * reconoce y devuelve su tipo e id. `null` si no matchea ese patrón (no es un enlace de Alegra
 * reconocible: se sigue probando como número o como id, tal cual antes).
 */
export function parsearUrlAlegra(tipeado: string): UrlAlegraParseada | null {
  const m = ALEGRA_DOC_URL_RE.exec(tipeado.trim())
  if (!m) return null
  const [, documento, id] = m
  return documento.toLowerCase() === "invoice" ? { tipo: "invoice", id } : { tipo: "otro", documento: documento.toLowerCase() }
}

/** Nombre legible del documento para el mensaje de error ("un remito", …); genérico si no se reconoce. */
export function nombreDocumentoAlegra(documento: string): string {
  return ALEGRA_DOCUMENTOS[documento] ?? "otro tipo de documento"
}

/**
 * ¿Se puede vincular esta factura a un pedido con ese contacto de Alegra (`cliente_codigo`,
 * null = consumidor final sin cuenta)? Borrador y anulada nunca. Con contacto, la factura
 * tiene que ser de ese contacto; sin contacto, el operador confirma viendo el nombre.
 */
export function validarFactura(
  factura: AlegraFacturaResumen,
  clienteCodigo: string | null,
): { ok: true; clienteVerificado: boolean } | { ok: false; motivo: MotivoFacturaInvalida } {
  if (factura.estado === "draft") return { ok: false, motivo: "borrador" }
  if (factura.estado === "void") return { ok: false, motivo: "anulada" }
  if (clienteCodigo) {
    if (factura.clienteAlegraId !== clienteCodigo) return { ok: false, motivo: "otro_cliente" }
    return { ok: true, clienteVerificado: true }
  }
  return { ok: true, clienteVerificado: false }
}

export interface ResolverFacturaDeps {
  porNumero: (numero: string, opts: { clientId?: string }) => Promise<AlegraFacturaResumen[]>
  porId: (alegraId: string) => Promise<AlegraFacturaResumen | null>
}

export type ResolverFacturaResult =
  | { kind: "ok"; factura: AlegraFacturaResumen }
  | { kind: "no_encontrada" }
  | { kind: "ambigua" }
  /** Enlace de Alegra a OTRO tipo de documento (no una factura): la ruta arma el error. */
  | { kind: "url_otro_documento"; documento: string }

/**
 * Lo tipeado, en el formato con el que filtra Alegra. `numberTemplate_fullNumber` no completa
 * ceros (probado 2026-09-24: "201-7040" → 0 resultados, "00201-00007040" → 1; la parte final
 * sola, "7040", sí matchea): "punto-número" se rellena a 5 y 8 dígitos. Lo demás va tal cual.
 */
export function numeroParaConsulta(tipeado: string): string {
  const m = /^(\d{1,5})\s*-\s*(\d{1,8})$/.exec(tipeado.trim())
  return m ? `${m[1].padStart(5, "0")}-${m[2].padStart(8, "0")}` : tipeado.trim()
}

function unicasPorId(lista: AlegraFacturaResumen[]): AlegraFacturaResumen[] {
  const vistas = new Map<string, AlegraFacturaResumen>()
  for (const x of lista) if (!vistas.has(x.alegraId)) vistas.set(x.alegraId, x)
  return [...vistas.values()]
}

/**
 * Busca la factura que tipeó el operador. Acepta el número (como siempre) o un enlace de
 * Alegra a la factura ("https://app.alegra.com/invoice/view/id/2618"): con enlace, resuelve
 * DIRECTO por id (`porId`), sin pasar por la búsqueda por número. Un enlace a otro tipo de
 * documento de Alegra se rechaza (`url_otro_documento`) antes de gastar ninguna request.
 *
 * Sin enlace, como mucho 3 requests a Alegra:
 *   1. por número (filtro de Alegra + coincidencia exacta acá);
 *   2. si no hubo y el pedido tiene contacto: por número entre las facturas del contacto
 *      (red por si Alegra ignora el filtro de número: trae las 30 más recientes del cliente);
 *   3. si no hubo y lo tipeado son sólo dígitos: como id de Alegra.
 * Con varias coincidencias, si exactamente una es del contacto del pedido gana esa; si no,
 * "ambigua" (el operador tiene que tipear el número completo).
 */
export async function resolverFactura(
  tipeado: string,
  clienteCodigo: string | null,
  deps: ResolverFacturaDeps,
): Promise<ResolverFacturaResult> {
  const t = tipeado.trim()

  const url = parsearUrlAlegra(t)
  if (url) {
    if (url.tipo === "otro") return { kind: "url_otro_documento", documento: url.documento }
    const porId = await deps.porId(url.id)
    return porId ? { kind: "ok", factura: porId } : { kind: "no_encontrada" }
  }

  if (!/[0-9A-Za-z]/.test(t)) return { kind: "no_encontrada" }

  const consulta = numeroParaConsulta(t)
  let candidatas = unicasPorId((await deps.porNumero(consulta, {})).filter((x) => numeroFacturaCoincide(x.numero, t)))
  if (candidatas.length === 0 && clienteCodigo) {
    candidatas = unicasPorId(
      (await deps.porNumero(consulta, { clientId: clienteCodigo })).filter((x) => numeroFacturaCoincide(x.numero, t)),
    )
  }
  if (candidatas.length > 1 && clienteCodigo) {
    const delCliente = candidatas.filter((x) => x.clienteAlegraId === clienteCodigo)
    if (delCliente.length === 1) return { kind: "ok", factura: delCliente[0] }
  }
  if (candidatas.length === 1) return { kind: "ok", factura: candidatas[0] }
  if (candidatas.length > 1) return { kind: "ambigua" }

  if (/^\d+$/.test(t)) {
    const porId = await deps.porId(t)
    if (porId) return { kind: "ok", factura: porId }
  }
  return { kind: "no_encontrada" }
}
