// Cobro en línea de un pedido del Shop (Mercado Pago, Payway) tal como lo ve el CRM: con qué pagó el
// comprador. Módulo PURO: lo usan el repo (DTO) y el detalle del pedido (cliente).
//
// `pago_info` es un jsonb que escribe el Shop (`InfoPago` en apps/clientes/src/lib/pagos/tipos.ts):
// se lee campo por campo y lo que no tenga la forma esperada se descarta.

/** Forma de pago con la que el Shop congeló el total del pedido (`orders.forma_cobro`). */
export type FormaElegida = "credito" | "debito" | "cuenta_mp"

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
  /** Slug de la sucursal cuya cuenta del procesador cobró (`pago_info.cuentaCobro`). Pagos anteriores: null. */
  cuentaCobro: string | null
  /** Slug de la cuenta que correspondía según la regla, sólo si el cobro se hizo con otra (fallback). */
  cuentaCobroPrevista: string | null
}

/** Con qué cuenta del procesador se cobró y si fue por fallback (la prevista no estaba o fue rechazada). */
export interface CuentaCobroDto {
  slug: string
  prevista: string | null
  fallback: boolean
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
  /** Cuenta de cobro; null en pagos anteriores a que el Shop la registrara. */
  cuenta: CuentaCobroDto | null
  /** Forma de pago elegida al congelar el total; ausente = pedido anterior o sin precios por forma. */
  formaElegida?: FormaElegida
}

const TIPOS: readonly TipoMedioPago[] = ["credito", "debito", "prepaga", "dinero_en_cuenta"]

const texto = (v: unknown, max = 80): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null

const monto = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null)

// Slug de sucursal tal como lo escribe el Shop (`orders.sucursal`): minúsculas, números y guiones.
const SLUG_CUENTA = /^[a-z0-9-]{2,20}$/
const slug = (v: unknown): string | null => (typeof v === "string" && SLUG_CUENTA.test(v) ? v : null)

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
    cuentaCobro: slug(o.cuentaCobro),
    cuentaCobroPrevista: slug(o.cuentaCobroPrevista),
  }
}

/** La cuenta de cobro del pago, o null si el pago es anterior a que se registrara. */
export function cuentaDeCobroDto(info: Pick<InfoPagoDto, "cuentaCobro" | "cuentaCobroPrevista">): CuentaCobroDto | null {
  if (!info.cuentaCobro) return null
  const fallback = !!info.cuentaCobroPrevista && info.cuentaCobroPrevista !== info.cuentaCobro
  return { slug: info.cuentaCobro, prevista: fallback ? info.cuentaCobroPrevista : null, fallback }
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
