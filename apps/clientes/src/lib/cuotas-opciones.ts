/**
 * Opciones de cuotas SIN INTERÉS cotizadas: una cotización por cantidad, cada una con la lista de SU
 * condición (cada cantidad es otro precio), y el mínimo contra la base (el total a la lista del pago
 * único). Sólo servidor: los montos salen siempre de acá, nunca del navegador.
 *
 * Lo usan el selector del carrito/checkout (`POST /api/carrito/cotizar`, sobre el carrito) y las
 * opciones del formulario de pago (sobre el PEDIDO: `opcionesCuotasDePedido`).
 */
import { cotizar, ignorarProblemasDeStock, type Cotizacion, type LineaPedida } from "./cotizacion";
import { baseParaCuotas, condicionesAplicables, montoPorCuota, type CondicionCuotas } from "./cuotas-sin-interes";
import type { MedioPago } from "./medios-pago";
import type { OpcionCobro } from "./pagos/opciones-cobro";
import { aplicadorDeCupon, opcionCupon } from "./cupones/aplicar";
import { promoDesdePedido } from "./cupones/reglas";
import type { CuponPedido } from "./cupones/tipos";

export interface OpcionCuotasCotizada {
  cuotas: number;
  /** Total a la lista de esa cantidad (con impuestos): lo que se cobra. */
  total: number;
  /** total / N redondeado al centavo hacia arriba. */
  montoCuota: number;
}

/** Cotiza las MISMAS líneas con otra lista (undefined = la de referencia). */
export type CotizarConLista = (idListaPrecios: string | undefined) => Promise<Cotizacion>;

/**
 * 1 pago (lista del pago único) y cada condición, ordenadas por cuotas. `totalBase` undefined = no se
 * comparan mínimos (no hay ninguno cargado): van todas las condiciones tal como vienen. Una cotización
 * con problemas o en 0 no se ofrece.
 */
export async function opcionesSinInteresCotizadas(a: {
  condiciones: readonly CondicionCuotas[] | null | undefined;
  idListaUnPago: string | undefined;
  totalBase: number | undefined;
  cotizarConLista: CotizarConLista;
  /** Cupón: se aplica a la cotización de cada cantidad (cuotas >= 2 = sin interés). */
  porCantidad?: (c: Cotizacion, cuotas: number) => Promise<Cotizacion>;
}): Promise<OpcionCuotasCotizada[]> {
  const cantidades = [
    { cuotas: 1, idListaPrecios: a.idListaUnPago },
    ...(a.totalBase === undefined ? (a.condiciones ?? []) : condicionesAplicables(a.condiciones, a.totalBase)),
  ];
  const opciones = await Promise.all(
    cantidades.map(async (c) => {
      const cotizada = await a.cotizarConLista(c.idListaPrecios);
      const q = a.porCantidad ? await a.porCantidad(cotizada, c.cuotas) : cotizada;
      if (q.hayProblemas || !(q.total > 0)) return null;
      return { cuotas: c.cuotas, total: q.total, montoCuota: montoPorCuota(q.total, c.cuotas) };
    }),
  );
  return opciones.filter((o): o is OpcionCuotasCotizada => o !== null).sort((x, y) => x.cuotas - y.cuotas);
}

/**
 * Base del mínimo: la cotización a la lista del pago único y, si esa lista no sirve (el medio no tiene o
 * un producto no tiene precio en ella), a la de referencia. null = no se pudo calcular: nunca se promete
 * con base 0.
 */
export async function baseParaCuotasCon(
  cotizarConLista: CotizarConLista,
  idListaUnPago: string | undefined,
  origen = "cuotas-opciones",
): Promise<number | null> {
  for (const lista of idListaUnPago ? [idListaUnPago, undefined] : [undefined]) {
    try {
      const b = baseParaCuotas(await cotizarConLista(lista));
      if (b !== null) return b;
    } catch (err) {
      console.error(`[${origen}] base de cuotas:`, err);
    }
  }
  return null;
}

/**
 * Opciones sin interés de un PEDIDO (pedido retomado incluido: las líneas salen del pedido, no del
 * carrito). `ignorarStock`: el pedido ya reserva sus unidades, un faltante no es problema (ver
 * `ignorarProblemasDeStock`). `base` null = no hay mínimos o no se pudo calcular.
 */
export async function opcionesCuotasDePedido(a: {
  lineas: LineaPedida[];
  medio: Pick<MedioPago, "condicionesCuotas"> & { slug?: string };
  /** Lista del pago único del medio (`idListaDelMedio(..., 1)`). */
  idListaUnPago: string | undefined;
  /** Las del pedido (entrega, disponibilidad, visibles), sin lista: la pone cada cantidad. */
  opcionesCotizar: Omit<NonNullable<Parameters<typeof cotizar>[1]>, "idListaMedio">;
  ignorarStock?: boolean;
  /** Cupón congelado del pedido: se aplica a cada cantidad si esa opción es elegible. */
  cupon?: CuponPedido | null;
  /** Forma del pago único del pedido (las cuotas >= 2 son crédito). */
  forma?: OpcionCobro | null;
}): Promise<{ base: number | null; opciones: OpcionCuotasCotizada[] }> {
  const cotizarConLista: CotizarConLista = async (idListaMedio) => {
    const c = await cotizar(a.lineas, { ...a.opcionesCotizar, idListaMedio });
    return a.ignorarStock ? ignorarProblemasDeStock(c) : c;
  };
  const condiciones = a.medio.condicionesCuotas ?? [];
  const hayMinimos = condiciones.some((c) => c.montoMinimo != null);
  const base = hayMinimos ? await baseParaCuotasCon(cotizarConLista, a.idListaUnPago, "opciones-cuotas-pedido") : null;
  const aplicar = a.cupon
    ? aplicadorDeCupon({
        cupon: { promo: promoDesdePedido(a.cupon), motivoCuenta: null, verificado: true, congelado: true },
        entrega: { tipo: a.opcionesCotizar.entregaTipo ?? "retiro", provincia: null },
        totalListaGeneral: async () => 0,
      })
    : null;
  const slug = a.medio.slug ?? "";
  const opciones = await opcionesSinInteresCotizadas({
    condiciones,
    idListaUnPago: a.idListaUnPago,
    // Con mínimos y sin base calculable: 0 (sólo las cantidades sin mínimo), como al crear el pedido.
    totalBase: hayMinimos ? (base ?? 0) : undefined,
    cotizarConLista,
    ...(aplicar ? { porCantidad: (c, n) => aplicar(c, opcionCupon(slug, n > 1 ? "credito" : (a.forma ?? null), n)) } : {}),
  });
  return { base, opciones };
}
