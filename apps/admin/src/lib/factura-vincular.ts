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

function unicasPorId(lista: AlegraFacturaResumen[]): AlegraFacturaResumen[] {
  const vistas = new Map<string, AlegraFacturaResumen>()
  for (const x of lista) if (!vistas.has(x.alegraId)) vistas.set(x.alegraId, x)
  return [...vistas.values()]
}

/**
 * Busca la factura que tipeó el operador. Como mucho 3 requests a Alegra:
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
  if (!/[0-9A-Za-z]/.test(t)) return { kind: "no_encontrada" }

  let candidatas = unicasPorId((await deps.porNumero(t, {})).filter((x) => numeroFacturaCoincide(x.numero, t)))
  if (candidatas.length === 0 && clienteCodigo) {
    candidatas = unicasPorId(
      (await deps.porNumero(t, { clientId: clienteCodigo })).filter((x) => numeroFacturaCoincide(x.numero, t)),
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
