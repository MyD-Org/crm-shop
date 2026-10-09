/**
 * Medio de pago, cuotas y lista de precios de un pedido: UNA sola resolución para crear el pedido
 * (`POST /api/pedidos`) y para cambiarle el medio (`POST /api/pedidos/:id/medio`). Sólo servidor.
 */
import { cotizar, ignorarProblemasDeStock, type Cotizacion, type LineaPedida } from "./cotizacion";
import { cuotasElegidas } from "./cuotas-sin-interes";
import { cuotasHabilitadas } from "./cuotas-flag";
import { idListaDelMedio, resolverForma } from "./lista-medio";
import type { OpcionCobro } from "./pagos/opciones-cobro";
import { mediosParaModalidad, type MedioPago, type OpcionesMedios } from "./medios-pago";
import type { EntregaTipo } from "./envio";
import type { ContextoDisponibilidad } from "./disponibilidad-contexto";

export interface OpcionesCotizarMedio {
  idListaPrivada: string | null;
  idListaMedio: string | undefined;
  entregaTipo: EntregaTipo;
  disp?: ContextoDisponibilidad;
  soloVisibles: boolean;
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
    }
  | { ok: false; motivo: "cuotas_no_disponibles" | "forma_no_disponible" };

/**
 * Cuotas sin interés (flag `cuotas-cobro`, sólo cobro en línea y sin lista privada) y lista del medio,
 * y la cotización que sale de ellas. `pagoMetodo` ya tiene que estar validado contra los medios.
 * `ignorarStock`: pedido que ya reserva sus unidades (ver `ignorarProblemasDeStock`).
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
  ignorarStock?: boolean;
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
  const opcionesCotizar = {
    idListaPrivada: a.idListaPrivada,
    idListaMedio,
    entregaTipo,
    disp: a.disp,
    soloVisibles: a.soloVisibles,
  };
  const cotizacion = await cotizarEstas(opcionesCotizar);
  return { ok: true, cuotasPedido, idListaMedio, formaCobro, opcionesCotizar, cotizacion };
}
