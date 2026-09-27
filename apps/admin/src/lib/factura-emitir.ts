import type { AlegraNumberTemplate } from "./alegra"
import type { PedidoItemRow, PedidoRow } from "./pedidos-repo"

// "Emitir factura" (detalle de pedido del admin, rebanada B): lógica pura para armar el preview
// de la emisión — contacto a usar, líneas, numeración sugerida, avisos y bloqueos — SIN tocar
// Alegra. Las lecturas de Alegra entran inyectadas (`ResolverPreviewEmisionDeps`), mismo patrón
// que `ResolverFacturaDeps` en factura-vincular.ts, para poder probar todo esto sin red.
//
// Esta rebanada NO crea nada en Alegra ni en la base: sólo arma el preview (GET, dry-run). La
// confirmación (POST que llama a `createInvoice`) es la rebanada C.

// ───────────────────────── Receptor / numeración por defecto ─────────────────────────

/**
 * ¿El receptor de la factura se identifica con CUIT? Cualquier otro caso (DNI, "otro", tipo o
 * número vacío, o un pedido sin datos de facturación) es `false` — igual que "consumidor final"
 * en el resto del dominio.
 */
export function tieneCuit(pedido: Pick<PedidoRow, "facturacionTipoDoc" | "facturacionNroDoc">): boolean {
  return pedido.facturacionTipoDoc === "CUIT" && Boolean(pedido.facturacionNroDoc?.trim())
}

/**
 * Numeración sugerida por defecto: primera `INVOICE_A` activa si el receptor tiene CUIT, si no
 * la primera `INVOICE_B` activa. `null` si no hay ninguna numeración activa del tipo buscado —
 * el operador la elige a mano, nunca se cae a C ni a "la primera disponible".
 *
 * PURA: no pega a Alegra, recibe la lista ya resuelta (puede traer numeraciones inactivas o de
 * otros tipos mezcladas; acá se filtra por tipo Y por `status === "active"`).
 */
export function elegirNumeracionPorDefecto(
  numeraciones: AlegraNumberTemplate[],
  receptor: { tieneCuit: boolean },
): string | null {
  const tipoDefault = receptor.tieneCuit ? "INVOICE_A" : "INVOICE_B"
  const encontrada = numeraciones.find((n) => n.subDocumentType === tipoDefault && n.status === "active")
  return encontrada?.alegraId ?? null
}

// ───────────────────────── Líneas de factura ─────────────────────────

export interface LineaFacturaPreview {
  alegraItemId: string
  nombre: string
  cantidad: number
  precioUnitario: number
  ivaPorcentaje: number
}

/** Aviso que impide confirmar la emisión (se muestra en el preview, atenuado o como alerta). */
export interface AvisoBloqueante {
  motivo: string
  detalle: string
}

export interface ResultadoLineasFactura {
  lineas: LineaFacturaPreview[]
  avisos: AvisoBloqueante[]
}

const num = (v: string | null | undefined): number => (v == null ? 0 : Number(v))

/**
 * Arma las líneas de factura desde los `order_items` del pedido. NUNCA agrega una línea por el
 * costo de envío (decisión de la usuaria: el envío queda excluido siempre, sin excepción
 * configurable). Un ítem sin `alegra_item_id` (la columna es NOT NULL hoy, pero se defiende
 * igual ante datos corruptos o de un pedido muy viejo) no se puede facturar: en vez de una línea
 * rota, produce un aviso bloqueante nombrando el ítem, sin lanzar excepción.
 */
export function armarLineasFactura(items: PedidoItemRow[]): ResultadoLineasFactura {
  const lineas: LineaFacturaPreview[] = []
  const avisos: AvisoBloqueante[] = []
  for (const item of items) {
    const alegraItemId = item.alegraItemId?.trim()
    if (!alegraItemId) {
      avisos.push({
        motivo: "item_sin_alegra_id",
        detalle: `El ítem "${item.name}" no tiene un producto de Alegra asociado. Corríjalo antes de emitir la factura.`,
      })
      continue
    }
    lineas.push({
      alegraItemId,
      nombre: item.name,
      cantidad: num(item.qty),
      precioUnitario: num(item.precioUnitario),
      ivaPorcentaje: num(item.ivaPorcentaje),
    })
  }
  return { lineas, avisos }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Total de una línea con IVA (lo que facturaría Alegra: `precioUnitario` es NETO — así lo
 * congela el checkout del Shop, ver `apps/clientes/src/db/schema.ts` — más el impuesto de la
 * propia línea). Mismo redondeo por línea que usa el Shop al calcular el pedido
 * (`cotizarItem`): subtotal → iva → total, cada paso redondeado a 2 decimales.
 */
function totalConIvaDeLinea(l: LineaFacturaPreview): number {
  const subtotal = round2(l.precioUnitario * l.cantidad)
  const iva = round2(subtotal * (l.ivaPorcentaje / 100))
  return round2(subtotal + iva)
}

/**
 * Diferencia, en valor absoluto, a partir de la cual el preview NO deja confirmar la emisión
 * por descuadre entre lo que facturaría Alegra y el total del pedido (sin envío). En la
 * práctica `precioUnitario`/`ivaPorcentaje` de `order_items` ya son un espejo congelado de lo
 * que el Shop usó para calcular `orders.subtotal`/`orders.iva` (misma fórmula, mismo
 * redondeo), así que esto sólo dispara ante datos inconsistentes (ítem excluido por
 * `armarLineasFactura`, edición manual de la base, etc.), nunca en el camino feliz.
 */
const DIFERENCIA_TOTAL_MAXIMA = 1

// ───────────────────────── Bloqueo por condición de IVA ─────────────────────────

/**
 * ¿Se puede emitir la factura? Bloquea si el pedido tiene el aviso "Documento incompatible con
 * la condición de IVA" (`requiereRevision`).
 *
 * Excepción (decisión de la usuaria, 2026-09-26, ver `sdd/admin-emitir-factura-pedido/decision-x-iva`
 * en engram): con la numeración "Presupuesto X" (`subDocumentType === "INVOICE_X"`, no fiscal)
 * SÍ se puede emitir aunque el pedido tenga ese aviso. Para A/B/C el bloqueo sigue siempre. El
 * día que se decida ampliar la excepción a otro tipo no fiscal, esta es la ÚNICA condición a
 * tocar — el resto del flujo no cambia.
 */
export function puedeEmitir(
  pedido: Pick<PedidoRow, "requiereRevision">,
  numeracion: Pick<AlegraNumberTemplate, "subDocumentType"> | null,
): { bloqueo: AvisoBloqueante | null } {
  if (!pedido.requiereRevision) return { bloqueo: null }
  if (numeracion?.subDocumentType === "INVOICE_X") return { bloqueo: null }
  return {
    bloqueo: {
      motivo: "documento_incompatible",
      detalle:
        'El pedido tiene el aviso "Documento incompatible con la condición de IVA". Corrija el documento del ' +
        'contacto en Alegra antes de emitir, o elija la numeración "Presupuesto X" (no fiscal) si corresponde.',
    },
  }
}

// ───────────────────────── Preview completo ─────────────────────────

export interface PreviewEmisionFactura {
  lineas: LineaFacturaPreview[]
  /** Suma de las líneas con IVA (lo que facturaría Alegra), SIN el costo de envío. */
  total: number
  /** `pedido.subtotal + pedido.iva` (sin envío), para comparar contra `total`. */
  totalPedido: number
  /** Numeraciones de factura activas de la cuenta (ya filtradas a `INVOICE_*` activas). */
  numeraciones: AlegraNumberTemplate[]
  numeracionSugeridaId: string | null
  contacto: { alegraId: string | null; esNuevo: boolean; nombre: string }
  /** Bloqueo por condición de IVA (`puedeEmitir`, con la numeración sugerida). `null` = no bloquea. */
  bloqueo: AvisoBloqueante | null
  /** Otros avisos bloqueantes: ítems sin `alegra_item_id`, descuadre de total > $1. */
  avisos: AvisoBloqueante[]
}

export interface ResolverPreviewEmisionDeps {
  listNumberTemplates: () => Promise<AlegraNumberTemplate[]>
  findContactByIdentifier: (documento: string) => Promise<{ alegraId: string } | null>
}

/**
 * Arma el preview completo de la emisión. Las llamadas a Alegra entran inyectadas (`deps`),
 * mismo patrón que `resolverFactura` en factura-vincular.ts, para poder testear sin red.
 *
 * NO escribe nada: ni en Alegra ni en la base. Sólo lee (`listNumberTemplates`,
 * `findContactByIdentifier`, ambas ya existentes en `alegra.ts`).
 */
export async function resolverPreviewEmision(
  pedido: PedidoRow,
  items: PedidoItemRow[],
  deps: ResolverPreviewEmisionDeps,
): Promise<PreviewEmisionFactura> {
  const numeracionesCrudas = await deps.listNumberTemplates()
  const numeraciones = numeracionesCrudas.filter(
    (n) => n.status === "active" && n.subDocumentType.startsWith("INVOICE_"),
  )
  const numeracionSugeridaId = elegirNumeracionPorDefecto(numeraciones, { tieneCuit: tieneCuit(pedido) })
  const numeracionSugerida = numeraciones.find((n) => n.alegraId === numeracionSugeridaId) ?? null

  let contactoAlegraId: string | null = pedido.clienteCodigo
  let esNuevo = false
  if (!contactoAlegraId) {
    const documento = pedido.facturacionNroDoc?.trim()
    const encontrado = documento ? await deps.findContactByIdentifier(documento) : null
    if (encontrado) {
      contactoAlegraId = encontrado.alegraId
    } else {
      esNuevo = true
    }
  }
  const nombreContacto = pedido.facturacionRazonSocial?.trim() || pedido.contactoNombre

  const { lineas, avisos: avisosLineas } = armarLineasFactura(items)
  const total = round2(lineas.reduce((acc, l) => acc + totalConIvaDeLinea(l), 0))
  const totalPedido = round2(num(pedido.subtotal) + num(pedido.iva))

  const avisos = [...avisosLineas]
  if (Math.abs(total - totalPedido) > DIFERENCIA_TOTAL_MAXIMA) {
    avisos.push({
      motivo: "diferencia_total",
      detalle:
        `El total a facturar ($${total.toFixed(2)}) difiere del total del pedido sin envío ` +
        `($${totalPedido.toFixed(2)}) en más de $${DIFERENCIA_TOTAL_MAXIMA}. Revise los ítems antes de emitir.`,
    })
  }

  const { bloqueo } = puedeEmitir(pedido, numeracionSugerida)

  return {
    lineas,
    total,
    totalPedido,
    numeraciones,
    numeracionSugeridaId,
    contacto: { alegraId: contactoAlegraId, esNuevo, nombre: nombreContacto },
    bloqueo,
    avisos,
  }
}
