// Reglas puras del cupón (spec apps/admin/docs/superpowers/specs/2026-11-01-cupones-design.md).
//
// `aplicarCupon` corre DESPUÉS de resolver lista y campañas: recibe la cotización ya hecha y deja el
// descuento DENTRO del unitario de cada línea alcanzada (como las campañas), así factura, cobro y
// cuotas no cambian. Carrito, POST /api/pedidos y el cambio de medio la llaman con el mismo
// contexto: el total que se ve es el que se cobra. Un cupón que no aplica no bloquea: devuelve la
// cotización intacta con `cuponError`.
import type { Cotizacion, LineaCotizada } from "../cotizacion";
import { redondear, totalizar } from "../cotizacion-totales";
import { claveProvincia } from "../sucursales";
import { mensajeCupon } from "./mensajes";
import type { ContextoCupon, CuponAplicado, CuponPedido, MotivoCupon, OpcionCupon, PromocionCupon } from "./tipos";

const AVISO_CAMPANIA = "El descuento no se suma a productos con precio promocional.";
const AVISO_INVITADO = "Se aplicará al confirmar si corresponde.";

/** Mayúsculas y sólo [A-Z0-9], de 4 a 24 caracteres (la misma clave que `codigo_norm` del CRM). */
export function normalizarCodigo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return n.length >= 4 && n.length <= 24 ? n : null;
}

/** Pausada se muestra como vencida al comprador; fin y `venceEn` son exclusivos. */
export function motivoVigencia(p: PromocionCupon, ahora: Date): MotivoCupon | null {
  const t = ahora.getTime();
  if (!p.activa) return "vencido";
  if (t >= new Date(p.fin).getTime()) return "vencido";
  if (p.venceEn && t >= new Date(p.venceEn).getTime()) return "vencido";
  if (t < new Date(p.inicio).getTime()) return "no_empezo";
  return null;
}

/**
 * Medio, forma y cuotas sin interés (sólo si la promoción las permite). La forma filtra sólo medios con
 * formas; un medio con formas sin forma conocida no pasa un filtro de formas (falla cerrado).
 */
export function opcionElegible(p: Pick<PromocionCupon, "medios" | "formas" | "permiteCuotas">, o: OpcionCupon): boolean {
  if (p.medios && !p.medios.includes(o.slug)) return false;
  if (p.formas && (o.forma !== null ? !p.formas.includes(o.forma) : Boolean(o.conFormas))) return false;
  if (o.cuotasSinInteres && !p.permiteCuotas) return false;
  return true;
}

function conError(c: Cotizacion, motivo: MotivoCupon, mensaje: string): Cotizacion {
  return { ...c, cupon: null, cuponError: { motivo, mensaje } };
}

function descontar(l: LineaCotizada, pct: number): LineaCotizada {
  const precioUnitario = redondear(l.precioUnitario * (1 - pct / 100));
  const subtotal = redondear(precioUnitario * l.qty);
  const iva = redondear(subtotal * (l.ivaPorcentaje / 100));
  return { ...l, precioSinCupon: l.precioUnitario, precioUnitario, subtotal, iva, total: redondear(subtotal + iva) };
}

export function aplicarCupon(c: Cotizacion, p: PromocionCupon, ctx: ContextoCupon): Cotizacion {
  const error = (m: MotivoCupon) => conError(c, m, mensajeCupon(m, p, ctx.nombresMedios, ctx.opcion ?? undefined));
  if (!ctx.congelado) {
    if (ctx.motivoCuenta) return error(ctx.motivoCuenta);
    const vigencia = motivoVigencia(p, ctx.ahora);
    if (vigencia) return error(vigencia);
    if (p.minimo !== null && ctx.totalListaGeneral < p.minimo) return error("minimo");
  }
  if (ctx.opcion && !opcionElegible(p, ctx.opcion)) return error("opcion_no_elegible");

  const alcanza = (l: LineaCotizada) => !l.problema && !l.campaniaId;
  const pctAplicado = p.pct !== null && c.lineas.some(alcanza);
  const envioGratis =
    p.envioGratis &&
    ctx.entrega.tipo === "envio" &&
    (p.provinciasEnvio === null || p.provinciasEnvio.includes(claveProvincia(ctx.entrega.provincia)));
  if (!pctAplicado && !envioGratis) return error(p.pct !== null ? "todo_en_campania" : "solo_envio");

  const lineas = pctAplicado ? c.lineas.map((l) => (alcanza(l) ? descontar(l, p.pct!) : l)) : c.lineas;
  const totales = totalizar(lineas, c.costoEnvio);
  const restringePago = Boolean(p.medios || p.formas);
  const avisos = [
    ...(!ctx.verificado ? [AVISO_INVITADO] : []),
    ...(!ctx.opcion && restringePago ? [mensajeCupon("opcion_no_elegible", p, ctx.nombresMedios)] : []),
    ...(p.pct !== null && !pctAplicado ? [AVISO_CAMPANIA] : []),
  ];
  const cupon: CuponAplicado = {
    codigo: p.codigo,
    codigoId: p.codigoId,
    promocionId: p.promocionId,
    nombre: p.nombre,
    pct: p.pct,
    pctAplicado,
    envioGratis,
    descuento: redondear(c.total - totales.total),
    subtotalAntes: c.subtotal,
    condiciones: p.condiciones,
    venceEn: p.venceEn,
    verificado: ctx.verificado,
    aviso: avisos.length ? avisos.join(" ") : null,
  };
  return { ...c, lineas, ...totales, cupon, cuponError: null };
}

/** La foto que congela el pedido (`orders.cupon`). */
export function cuponPedidoDesde(c: CuponAplicado, p: PromocionCupon, envioGratisTienda?: boolean): CuponPedido {
  return {
    codigoId: p.codigoId,
    codigo: p.codigo,
    promocionId: p.promocionId,
    nombre: p.nombre,
    pct: p.pct,
    envioGratis: p.envioGratis,
    provinciasEnvio: p.provinciasEnvio,
    medios: p.medios,
    formas: p.formas,
    permiteCuotas: p.permiteCuotas,
    condiciones: p.condiciones,
    descuento: c.descuento,
    envioGratisAplicado: c.envioGratis,
    ...(envioGratisTienda !== undefined ? { envioGratisTienda } : {}),
  };
}

/**
 * La promoción a partir de la foto del pedido, para recotizarlo con `congelado: true` (vigencia,
 * mínimo y cuenta no se vuelven a mirar: ya se validaron al crearlo).
 */
export function promoDesdePedido(s: CuponPedido): PromocionCupon {
  return {
    codigoId: s.codigoId,
    codigo: s.codigo,
    promocionId: s.promocionId,
    nombre: s.nombre,
    tipo: "unicos",
    pct: s.pct,
    // El envío gratis ya se decidió al crear (la entrega no cambia): se recotiza con ese resultado.
    envioGratis: s.envioGratisAplicado ?? s.envioGratis,
    provinciasEnvio: s.envioGratisAplicado === undefined ? s.provinciasEnvio : null,
    inicio: new Date(0).toISOString(),
    fin: new Date(8.64e15).toISOString(),
    venceEn: null,
    soloPrimeraCompra: false,
    minimo: null,
    medios: s.medios,
    formas: s.formas,
    permiteCuotas: s.permiteCuotas,
    limiteCanjes: null,
    condiciones: s.condiciones,
    activa: true,
  };
}

/**
 * La foto del cupón de un pedido después de recotizarlo (cambio de medio): la misma con el descuento
 * de la lista nueva si el cupón siguió aplicando; null si la opción nueva no es elegible (el pedido
 * pierde el cupón y se libera el canje).
 */
export function cuponTrasRecotizar(previo: CuponPedido | null, c: Cotizacion): CuponPedido | null {
  if (!previo || !c.cupon) return null;
  return { ...previo, descuento: c.cupon.descuento };
}
