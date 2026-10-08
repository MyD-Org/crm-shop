// Cobro en línea de un pedido del Shop (Mercado Pago, Payway) tal como lo ve el CRM: con qué pagó el
// comprador. Módulo PURO: lo usan el repo (DTO) y el detalle del pedido (cliente).
//
// `pago_info` es un jsonb que escribe el Shop (`InfoPago` en apps/clientes/src/lib/pagos/tipos.ts):
// se lee campo por campo y lo que no tenga la forma esperada se descarta.

export type TipoMedioPago = "credito" | "debito" | "prepaga" | "dinero_en_cuenta"

export interface InfoPagoDto {
  tipo: TipoMedioPago | null
  marca: string | null
  ultimos4: string | null
  aprobadoEn: string | null
  autorizacion: string | null
  cupon: string | null
  /** Lo que el proveedor le acredita a la tienda, ya descontados sus cargos. Pagos anteriores: null. */
  netoRecibido: number | null
  /** Lo que descontó el proveedor (comisión, costo de las cuotas sin interés…). */
  costoProcesador: number | null
}

export interface PagoEnLineaDto {
  /** 'mercadopago' | 'payway' | … */
  proveedor: string
  /** Id del pago en el proveedor (Mercado Pago) o `site_transaction_id` (Payway). */
  referencia: string | null
  /** 'tarjeta' | 'cuenta_mp'. */
  medio: string | null
  cuotas: number | null
  /** Lo que pagó el comprador, con el interés de las cuotas si lo hubo. */
  totalPagado: number | null
  info: InfoPagoDto
}

const TIPOS: readonly TipoMedioPago[] = ["credito", "debito", "prepaga", "dinero_en_cuenta"]

const texto = (v: unknown, max = 80): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null

const monto = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null)

export function parseInfoPago(raw: unknown): InfoPagoDto {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const tipo = typeof o.tipo === "string" && (TIPOS as readonly string[]).includes(o.tipo) ? (o.tipo as TipoMedioPago) : null
  const ultimos4 = typeof o.ultimos4 === "string" && /^\d{4}$/.test(o.ultimos4) ? o.ultimos4 : null
  const aprobado = texto(o.aprobadoEn)
  return {
    tipo,
    marca: texto(o.marca, 40),
    ultimos4,
    aprobadoEn: aprobado && !Number.isNaN(Date.parse(aprobado)) ? new Date(aprobado).toISOString() : null,
    autorizacion: texto(o.autorizacion, 40),
    cupon: texto(o.cupon, 40),
    netoRecibido: monto(o.netoRecibido),
    costoProcesador: monto(o.costoProcesador),
  }
}

const TIPO_LABEL: Record<TipoMedioPago, string> = {
  credito: "crédito",
  debito: "débito",
  prepaga: "prepaga",
  dinero_en_cuenta: "",
}

/**
 * Con qué pagó, en una línea: "Mastercard crédito •••• 4623", "Dinero en cuenta de Mercado Pago",
 * "Tarjeta de crédito" o, sin ningún dato (pagos anteriores), "Tarjeta" / "Cuenta de Mercado Pago".
 */
export function textoMedioCobrado(p: Pick<PagoEnLineaDto, "medio" | "info">): string | null {
  const { tipo, marca, ultimos4 } = p.info
  if (tipo === "dinero_en_cuenta") return "Dinero en cuenta de Mercado Pago"
  const partes: string[] = []
  if (marca) partes.push(marca)
  if (tipo) partes.push(marca ? TIPO_LABEL[tipo] : tipo === "prepaga" ? "Tarjeta prepaga" : `Tarjeta de ${TIPO_LABEL[tipo]}`)
  if (ultimos4) partes.push(`•••• ${ultimos4}`)
  if (partes.length > 0) {
    const linea = partes.join(" ")
    return p.medio === "cuenta_mp" ? `${linea} (desde la cuenta de Mercado Pago)` : linea
  }
  if (p.medio === "cuenta_mp") return "Cuenta de Mercado Pago"
  if (p.medio === "tarjeta") return "Tarjeta"
  return null
}
