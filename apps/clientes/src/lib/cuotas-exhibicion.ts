/**
 * Qué se muestra de cuotas en cada superficie (card, ficha, carrito, checkout).
 *
 * Módulo puro, corre en el cliente: el cálculo lo hace el motor (`cuotas.ts`)
 * sobre la `OfertaCuotas` que el Server Component pasa como prop. Acá sólo se
 * decide QUÉ mostrar. Cualquier dato faltante (oferta null por flag apagado o
 * sin datos, producto sin IVA, carrito sin cotizar) → no se muestra nada.
 */
import { maxCuotas, mejorOpcion, opcionesPara, proximoEscalon } from "./cuotas";
import { precioFinal as calcularPrecioFinal } from "./precio-final";
import { TEXTOS_CUOTAS } from "./cuotas-textos";
import type { OfertaCuotas, OpcionCuotas } from "./pagos/cuotas-tipos";

const montoValido = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/** Mejor opción para un precio final unitario (card y ficha). */
export function mejorOpcionPara(
  precioFinal: number | null | undefined,
  oferta: OfertaCuotas | null,
): OpcionCuotas | null {
  if (!oferta || !montoValido(precioFinal)) return null;
  return mejorOpcion(opcionesPara(precioFinal, oferta));
}

export interface ResumenCuotas {
  /**
   * "Hasta N cuotas" con N = la mayor cantidad disponible, + " sin interés" si
   * esa cantidad tiene tasa 0. null si hoy no hay opciones.
   */
  titulo: string | null;
  mejor: OpcionCuotas | null;
  escalon: {
    texto: string;
    /** 0..100, hacia abajo: la barra nunca se ve llena sin haber llegado. */
    progresoPct: number;
    faltante: number;
    montoMinimo: number;
  } | null;
}

/**
 * Carrito (con escalón) y checkout (con el máximo congelado del pedido, sin
 * escalón: el pedido ya está armado). null si no hay nada que mostrar.
 */
export function resumenCuotas(
  base: number | null | undefined,
  oferta: OfertaCuotas | null,
  opts: { cuotasMax?: number | null } = {},
): ResumenCuotas | null {
  if (!oferta || !montoValido(base)) return null;

  const tope = opts.cuotasMax;
  const todas = opcionesPara(base, oferta);
  const opciones = typeof tope === "number" ? todas.filter((o) => o.cuotas <= tope) : todas;
  const mejor = mejorOpcion(opciones);
  const n = maxCuotas(opciones);
  const titulo =
    n > 1 ? TEXTOS_CUOTAS.hasta(n, opciones.some((o) => o.cuotas === n && o.sinInteres)) : null;

  const e = opts.cuotasMax === undefined ? proximoEscalon(base, oferta) : null;
  const escalon = e
    ? {
        texto: TEXTOS_CUOTAS.teFaltan(e.faltante, e.cuotas),
        progresoPct: Math.max(0, Math.min(100, Math.floor((base / e.montoMinimo) * 100))),
        faltante: e.faltante,
        montoMinimo: e.montoMinimo,
      }
    : null;

  if (!titulo && !escalon) return null;
  return { titulo, mejor, escalon };
}

export interface BloqueProveedor {
  proveedor: string;
  /** "Tarjetas de crédito (Mercado Pago)". */
  titulo: string;
  precioContado: number;
  /** Vacío = para este precio el proveedor sólo tiene 1 pago. */
  opciones: OpcionCuotas[];
}

/**
 * Modal "Ver medios de pago": un bloque por proveedor (aplica a todas las
 * tarjetas de crédito), en el orden de la oferta, con todas las cantidades
 * disponibles hasta el máximo del escalón.
 */
export function bloquesMediosDePago(
  precioFinal: number | null | undefined,
  oferta: OfertaCuotas | null,
): BloqueProveedor[] {
  if (!oferta || !montoValido(precioFinal)) return [];
  const opciones = opcionesPara(precioFinal, oferta);
  return oferta.proveedores.map((p) => ({
    proveedor: p.proveedor,
    titulo: TEXTOS_CUOTAS.tituloProveedor(p.nombre),
    precioContado: precioFinal,
    opciones: opciones.filter((o) => o.proveedor === p.proveedor),
  }));
}

/** Lo mínimo de una línea cotizada que hace falta para estimar. */
export interface LineaConocida {
  id: string;
  precioUnitario: number;
  ivaPorcentaje: number;
  problema?: string;
}

/**
 * Monto base del carrito.
 *
 * Con la cotización vigente, su total (lo que se va a cobrar). Mientras se
 * recotiza tras un cambio de cantidad, se estima con el precio y el IVA de la
 * última cotización y las cantidades nuevas: así la barra reacciona al instante
 * sin esperar al servidor. Si algún producto no tiene precio/IVA conocido, no se
 * inventa nada → null (no se muestran cuotas hasta que llegue la cotización).
 */
export function baseCarrito(args: {
  items: { id: string; qty: number }[];
  totalConfirmado: number | null;
  ultimasLineas: LineaConocida[] | null;
}): number | null {
  if (montoValido(args.totalConfirmado)) return args.totalConfirmado;
  if (args.items.length === 0 || !args.ultimasLineas) return null;

  const porId = new Map(args.ultimasLineas.map((l) => [l.id, l]));
  let total = 0;
  for (const item of args.items) {
    const l = porId.get(item.id);
    if (!l || l.problema) return null;
    const unitario = calcularPrecioFinal(l.precioUnitario, l.ivaPorcentaje);
    if (unitario === undefined) return null;
    total += unitario * item.qty;
  }
  return montoValido(total) ? Math.round(total * 100) / 100 : null;
}
