import type { AlegraRemisionResumen, AlegraRemissionLineInput } from "./alegra"
import { nombreDocumentoAlegra, numeroFacturaCoincide, numeroParaConsulta, parsearUrlAlegraCualquiera } from "./factura-vincular"
import type { PedidoItemRow, PedidoRow } from "./pedidos-repo"

// "Emitir remito" / "Vincular remito existente" (rebanada D, remito único por pedido). Lógica
// pura: las lecturas de Alegra entran inyectadas (`deps`) para poder probarla sin red, mismo
// patrón que `factura-vincular.ts`.
//
// DECISIÓN DE LA USUARIA: un remito único e íntegro por pedido — nunca entregas parciales. Por
// eso `armarLineasRemito` siempre manda TODAS las líneas del pedido (sin costo de envío, que
// nunca es mercadería), a diferencia de un remito parcial que elegiría un subconjunto.

/** Segmentos alfanuméricos + coincidencia de número: mismo algoritmo que las facturas (no es
 *  específico de factura pese al nombre: compara números legibles de Alegra en general). */
export { numeroFacturaCoincide as numeroRemitoCoincide, numeroParaConsulta }

// ───────────────────────── Enlace de Alegra a un remito ─────────────────────────

export type UrlAlegraRemitoParseada = { tipo: "remission"; id: string } | { tipo: "otro"; documento: string }

/**
 * Si `tipeado` es un enlace de Alegra a un documento, lo reconoce y dice si es un remito
 * (`remission`) o algún otro tipo (factura, cotización…), que se rechaza con un error propio en
 * la ruta. `null` si no matchea el patrón de enlace de Alegra (se sigue probando como número o
 * id, igual que antes).
 */
export function parsearUrlAlegraRemito(tipeado: string): UrlAlegraRemitoParseada | null {
  const r = parsearUrlAlegraCualquiera(tipeado)
  if (!r) return null
  return r.documento === "remission" ? { tipo: "remission", id: r.id } : { tipo: "otro", documento: r.documento }
}

export { nombreDocumentoAlegra }

// ───────────────────────── Resolver "Vincular remito existente" ─────────────────────────

export interface ResolverRemitoDeps {
  porNumero: (numero: string, opts: { clientId?: string }) => Promise<AlegraRemisionResumen[]>
  porId: (alegraId: string) => Promise<AlegraRemisionResumen | null>
}

export type ResolverRemitoResult =
  | { kind: "ok"; remision: AlegraRemisionResumen }
  | { kind: "no_encontrado" }
  | { kind: "ambiguo" }
  | { kind: "url_otro_documento"; documento: string }

/**
 * Busca el remito que tipeó el operador: número (como lo muestra Alegra), enlace de Alegra al
 * remito, o id numérico. Misma estrategia que `resolverFactura` (factura-vincular.ts): con
 * enlace resuelve directo por id; sin enlace, hasta 3 requests (por número, por número +
 * cliente del pedido, por id).
 */
export async function resolverRemito(
  tipeado: string,
  clienteCodigo: string | null,
  deps: ResolverRemitoDeps,
): Promise<ResolverRemitoResult> {
  const t = tipeado.trim()

  const url = parsearUrlAlegraRemito(t)
  if (url) {
    if (url.tipo === "otro") return { kind: "url_otro_documento", documento: url.documento }
    const porId = await deps.porId(url.id)
    return porId ? { kind: "ok", remision: porId } : { kind: "no_encontrado" }
  }

  if (!/[0-9A-Za-z]/.test(t)) return { kind: "no_encontrado" }

  const consulta = numeroParaConsulta(t)
  let candidatas = unicasPorId((await deps.porNumero(consulta, {})).filter((x) => numeroFacturaCoincide(x.numero, t)))
  if (candidatas.length === 0 && clienteCodigo) {
    candidatas = unicasPorId(
      (await deps.porNumero(consulta, { clientId: clienteCodigo })).filter((x) => numeroFacturaCoincide(x.numero, t)),
    )
  }
  if (candidatas.length > 1 && clienteCodigo) {
    const delCliente = candidatas.filter((x) => x.clienteAlegraId === clienteCodigo)
    if (delCliente.length === 1) return { kind: "ok", remision: delCliente[0] }
  }
  if (candidatas.length === 1) return { kind: "ok", remision: candidatas[0] }
  if (candidatas.length > 1) return { kind: "ambiguo" }

  if (/^\d+$/.test(t)) {
    const porId = await deps.porId(t)
    if (porId) return { kind: "ok", remision: porId }
  }
  return { kind: "no_encontrado" }
}

function unicasPorId(lista: AlegraRemisionResumen[]): AlegraRemisionResumen[] {
  const vistas = new Map<string, AlegraRemisionResumen>()
  for (const x of lista) if (!vistas.has(x.alegraId)) vistas.set(x.alegraId, x)
  return [...vistas.values()]
}

/**
 * ¿Se puede vincular este remito al pedido? Con contacto en el pedido, el remito tiene que ser
 * de ese contacto; sin contacto (consumidor final), el operador confirma viendo el nombre. A
 * diferencia de una factura, un remito no tiene "borrador" ni "anulado" que bloqueen acá: Alegra
 * no expone un estado de remito relevante para esta decisión.
 */
export function validarRemision(
  remision: AlegraRemisionResumen,
  clienteCodigo: string | null,
): { ok: true; clienteVerificado: boolean } {
  if (clienteCodigo && remision.clienteAlegraId === clienteCodigo) return { ok: true, clienteVerificado: true }
  return { ok: true, clienteVerificado: false }
}

// ───────────────────────── "Emitir remito" ─────────────────────────

export interface LineaRemitoPreview {
  alegraItemId: string
  nombre: string
  cantidad: number
}

export interface PreviewRemito {
  lineas: LineaRemitoPreview[]
  /** Ítems del pedido sin `alegra_item_id`: no se pueden remitir, avisa y bloquea. */
  avisos: string[]
}

/**
 * Arma las líneas del remito a partir de TODOS los ítems del pedido (remito íntegro, sin
 * parciales) en `price: 0`. Un `order_item` sin `alegra_item_id` no debería poder llegar acá
 * (el pedido ya se resolvió contra el catálogo al facturar/armar), pero si pasara, se avisa en
 * vez de omitirlo en silencio.
 */
export function armarPreviewRemito(items: PedidoItemRow[]): PreviewRemito {
  const lineas: LineaRemitoPreview[] = []
  const avisos: string[] = []
  for (const item of items) {
    if (!item.alegraItemId) {
      avisos.push(`"${item.name}" no tiene un ítem de Alegra asociado: no se puede remitir.`)
      continue
    }
    lineas.push({ alegraItemId: item.alegraItemId, nombre: item.name, cantidad: Number(item.qty) })
  }
  return { lineas, avisos }
}

/**
 * ¿Se puede emitir un remito para este pedido? Reusa el mismo contacto que la factura (el
 * remito no crea uno nuevo): si el pedido todavía no tiene `cliente_codigo` (consumidor final
 * sin factura, o factura sin persistir), no hay a quién emitirle el remito en Alegra. El
 * operador tiene que facturar primero, o vincular un remito ya emitido a mano.
 */
export function puedeEmitirRemito(pedido: Pick<PedidoRow, "clienteCodigo">): { bloqueo: string | null } {
  if (!pedido.clienteCodigo) {
    return {
      bloqueo:
        "Este pedido no tiene un cliente de Alegra asociado: facture el pedido primero, o vincule un remito ya emitido en Alegra.",
    }
  }
  return { bloqueo: null }
}

/** Líneas de remito para `createRemission`, siempre en 0 (ver el comentario de `alegra.ts`). */
export function lineasParaAlegra(lineas: LineaRemitoPreview[]): AlegraRemissionLineInput[] {
  return lineas.map((l) => ({ alegraId: l.alegraItemId, quantity: l.cantidad }))
}

/**
 * Observaciones del remito: nombra el pedido y, si ya está facturado, la factura — mismo
 * criterio que el cambio hermano de este dominio (no hay campo nativo de Alegra que relacione
 * un remito con una factura ya emitida).
 */
export function observacionesRemito(numeroPedido: string, facturaNumero: string | null): string {
  const partes = [`Pedido ${numeroPedido}`]
  if (facturaNumero) partes.push(`Factura ${facturaNumero}`)
  return partes.join(" · ")
}
