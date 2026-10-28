/**
 * Medio de pago, cuotas y lista de precios de un pedido: UNA sola resolución para crear el pedido
 * (`POST /api/pedidos`) y para cambiarle el medio (`POST /api/pedidos/:id/medio`). Sólo servidor.
 */
import { cotizar, ignorarProblemasDeStock, type Cotizacion, type LineaPedida } from "./cotizacion";
import { cuotasElegidas } from "./cuotas-sin-interes";
import { cuotasHabilitadas } from "./cuotas-flag";
import { idListaDelMedio, resolverForma } from "./lista-medio";
import type { OpcionCobro } from "./pagos/opciones-cobro";
import { SLUG_A_COORDINAR, mediosParaModalidad, type MedioPago, type OpcionesMedios } from "./medios-pago";
import type { EntregaTipo } from "./envio";
import type { ContextoDisponibilidad } from "./disponibilidad-contexto";
import type { FlujoPedido } from "./venta-sin-stock";

export interface OpcionesCotizarMedio {
  idListaPrivada: string | null;
  idListaMedio: string | undefined;
  entregaTipo: EntregaTipo;
  disp?: ContextoDisponibilidad;
  soloVisibles: boolean;
  /** Flag `variantes-selector` (overlay del ancla del grupo). Ausente = apagado. */
  agrupar?: boolean;
  /**
   * Venta sin stock con el flag `disponibilidad-sucursal`: ids que el motor dejó "por pedido" para la
   * entrega del pedido. Viaja a las recotizaciones del 409 para que marquen las mismas líneas.
   */
  aPedido?: ReadonlySet<string>;
}

export type ResultadoMedio =
  | {
      ok: true;
      cuotasPedido: number | null;
      idListaMedio: string | undefined;
      /** Forma de pago congelada; null = el medio no tiene precios distintos por forma (o no aplica). */
      formaCobro: OpcionCobro | null;
      opcionesCotizar: OpcionesCotizarMedio;
      cotizacion: Cotizacion;
      /** `a_confirmar` si alguna línea va a pedido con una modalidad a confirmar. */
      flujo: FlujoPedido;
    }
  | { ok: false; motivo: "cuotas_no_disponibles" | "forma_no_disponible" };

/**
 * Cuotas sin interés (flag `cuotas-cobro`, sólo cobro en línea y sin lista privada) y lista del medio,
 * y la cotización que sale de ellas. `pagoMetodo` ya tiene que estar validado contra los medios.
 * `ignorarStock`: pedido que ya reserva sus unidades (ver `ignorarProblemasDeStock`).
 *
 * Pedido a confirmar por modalidad de venta sin stock: con `pagoMetodo` "a_coordinar", sin lista
 * privada ni cuenta corriente, una cotización con flujo `a_confirmar` se rehace con
 * `idListaAConfirmar` (la lista que muestran las cards) y esa lista es la del pedido. Nunca para un
 * pedido existente (`ignorarStock`): su reserva propia puede hacer leer "a pedido" una línea que no
 * lo era, y eso no le cambia ni el flujo ni la lista.
 */
export async function cotizarConMedio(a: {
  lineas: LineaPedida[];
  entregaTipo: EntregaTipo;
  pagoMetodo: string;
  cuotasPedidas: unknown;
  /** Forma de pago pedida (`credito`, `debito`, `cuenta_mp`); solo cuenta con un medio de Mercado Pago o Payway. */
  formaPedida?: unknown;
  mediosCrm: readonly MedioPago[];
  opcionesMedios: OpcionesMedios;
  idListaPrivada: string | null;
  disp?: ContextoDisponibilidad;
  soloVisibles: boolean;
  /** Flag `variantes-selector`: se cotiza con el overlay del ancla del grupo. Ausente = apagado. */
  agrupar?: boolean;
  ignorarStock?: boolean;
  /** Venta sin stock (flag `disponibilidad-sucursal`): ids que van a pedido (`idsAPedido`). */
  aPedido?: ReadonlySet<string>;
  /** Lista de un pedido a confirmar por modalidad (`listaAConfirmar`); ausente = no se recotiza. */
  idListaAConfirmar?: string;
  /** Para los logs. */
  origen?: string;
}): Promise<ResultadoMedio> {
  const { lineas, entregaTipo, pagoMetodo, mediosCrm } = a;
  const cotizarEstas = async (o: Parameters<typeof cotizar>[1]) => {
    const c = await cotizar(lineas, o);
    return a.ignorarStock ? ignorarProblemasDeStock(c) : c;
  };
  // Con lista privada el precio ya no depende del medio: se ignora.
  const conMedio = !a.idListaPrivada;
  const medioDelPedido = mediosParaModalidad(mediosCrm, entregaTipo, a.opcionesMedios).find(
    (m) => m.slug === pagoMetodo,
  );
  // Forma de pago: solo con un medio de cobro en línea y sin lista privada (el precio no depende del medio).
  let formaCobro: OpcionCobro | null = null;
  if (conMedio && medioDelPedido?.cobroOnline) {
    const f = resolverForma(medioDelPedido, a.formaPedida);
    if (!f.ok) return { ok: false, motivo: "forma_no_disponible" };
    formaCobro = f.forma;
    // Las cuotas sin interés son de crédito: con otra forma pedida no hay cuotas.
    if (typeof a.cuotasPedidas === "number" && a.cuotasPedidas >= 2 && f.pedida && f.pedida !== "credito") {
      return { ok: false, motivo: "cuotas_no_disponibles" };
    }
  }
  let cuotasPedido: number | null = null;
  if (conMedio && medioDelPedido?.cobroOnline && (await cuotasHabilitadas())) {
    // Monto mínimo por cantidad de cuotas: la base es el total con impuestos a la lista del PAGO ÚNICO
    // del medio, cotizado acá en el servidor. Sólo se cotiza si hay algún mínimo y se pidieron cuotas.
    const hayMinimos = (medioDelPedido.condicionesCuotas ?? []).some((c) => c.montoMinimo != null);
    let totalBase: number | undefined;
    if (hayMinimos && typeof a.cuotasPedidas === "number" && a.cuotasPedidas >= 2) {
      const cotBase = await cotizarEstas({
        idListaMedio: idListaDelMedio(mediosCrm, entregaTipo, pagoMetodo, undefined, 1, formaCobro ? "credito" : null),
        entregaTipo,
        disp: a.disp,
        soloVisibles: a.soloVisibles,
        ...(a.agrupar ? { agrupar: true } : {}),
        ...(a.aPedido ? { aPedido: a.aPedido } : {}),
      });
      totalBase = cotBase.hayProblemas ? 0 : cotBase.total;
      console.info(
        `[${a.origen ?? "/api/pedidos"}] cuotas=${a.cuotasPedidas}: base del pago único ${totalBase} contra el mínimo de la condición`,
      );
    }
    const elegidas = cuotasElegidas(a.cuotasPedidas, medioDelPedido.condicionesCuotas, totalBase);
    if (!elegidas.ok) return { ok: false, motivo: "cuotas_no_disponibles" };
    cuotasPedido = elegidas.cuotas;
    if (formaCobro && formaCobro !== "credito" && cuotasPedido >= 2) return { ok: false, motivo: "cuotas_no_disponibles" };
  }
  const idListaMedio = conMedio ? idListaDelMedio(mediosCrm, entregaTipo, pagoMetodo, undefined, cuotasPedido, formaCobro) : undefined;
  const opcionesCotizar: OpcionesCotizarMedio = {
    idListaPrivada: a.idListaPrivada,
    idListaMedio,
    entregaTipo,
    disp: a.disp,
    soloVisibles: a.soloVisibles,
    ...(a.agrupar ? { agrupar: true } : {}),
    ...(a.aPedido ? { aPedido: a.aPedido } : {}),
  };
  const cotizacion = await cotizarEstas(opcionesCotizar);
  const aConfirmar =
    pagoMetodo === SLUG_A_COORDINAR &&
    conMedio &&
    !a.opcionesMedios.esCuentaCorriente &&
    !a.ignorarStock &&
    Boolean(a.idListaAConfirmar) &&
    cotizacion.flujo === "a_confirmar";
  if (aConfirmar) {
    // "a_coordinar" no es un medio: no tiene cuotas ni forma (ya quedaron en null más arriba).
    const opcionesAConfirmar: OpcionesCotizarMedio = { ...opcionesCotizar, idListaMedio: a.idListaAConfirmar };
    const recotizada = await cotizarEstas(opcionesAConfirmar);
    return {
      ok: true,
      cuotasPedido: null,
      idListaMedio: a.idListaAConfirmar,
      formaCobro: null,
      opcionesCotizar: opcionesAConfirmar,
      cotizacion: recotizada,
      flujo: recotizada.flujo,
    };
  }
  return { ok: true, cuotasPedido, idListaMedio, formaCobro, opcionesCotizar, cotizacion, flujo: cotizacion.flujo };
}
