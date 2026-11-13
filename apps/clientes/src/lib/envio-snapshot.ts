/**
 * Foto del envío por zona que se congela en `orders.envio_detalle` (change `envio-por-zona-con-tarifa`).
 * El CRM lee este JSON (factura, detalle del pedido, confirmación), así que la forma es un contrato
 * (`v` versiona). Sin método (retiro, a coordinar) las columnas `envio_*` quedan NULL.
 *
 * Módulo PURO (sin DB ni reloj propio): `crearPedido` lo llama con el instante de la creación.
 */
import { TZ_ENVIO, fechaEntrega, type FechaEntrega, type HorarioEnvio } from "./entrega-fecha";
import { fechasFeriadas, type ResultadoMetodoTienda } from "./envio-zona-tienda";

export interface EnvioDetalle {
  v: 1;
  metodoId: string;
  slug: string;
  zonaId: string;
  zona: string;
  /** Tarifa de la zona con IVA, aunque el envío haya salido gratis. */
  precio: number;
  regla: "poligono" | "cp" | "georef";
  precision: "altura" | "calle" | null;
  /** Coordenadas verificadas de la dirección (dato personal) o null si la regla fue cp/georef. */
  punto: { lat: number; lon: number } | null;
  /** `feriados` es opcional: los pedidos anteriores no lo traen (se calcula como si no hubiera feriados). */
  horario: { dias: number[]; horaCorte: string; margenMin: number; tz: string; feriados?: string[] };
  alegra: { itemId: string | null; ivaPct: number };
  avisoFeriados: string;
  /** El pago es en línea (la promesa del día vale sólo con pago aprobado). */
  medioOnline: boolean;
  /** Envío a coordinar elegido explícitamente por no poder ubicar la dirección (hoy no se guarda: sin método no hay snapshot). */
  sinUbicar?: true;
}

/** Columnas planas de `orders` que acompañan al detalle. */
export interface ColumnasEnvio {
  envioMetodo: string;
  envioZona: string;
  envioPromesa: string;
  envioEntregaEstimada: string;
}

/**
 * Fecha estimada de entrega al crear el pedido. Con pago en línea, la del instante de la creación (el
 * cobro suele ser inmediato). Sin pago en línea la confirmación llega después (el operador la registra),
 * así que NUNCA se promete el mismo día: se toma el siguiente día operativo.
 */
export function estimarEntrega(ahora: Date, horario: HorarioEnvio, medioOnline: boolean): FechaEntrega {
  const e = fechaEntrega(ahora, horario);
  if (medioOnline || !e.mismoDia) return e;
  // Un día después: la primera fecha operativa a partir de mañana (con la hora de hoy sirve el mismo criterio).
  return { fecha: fechaEntrega(new Date(ahora.getTime() + 24 * 60 * 60 * 1000), horario).fecha, mismoDia: false };
}

export function armarEnvioPedido(
  r: ResultadoMetodoTienda,
  a: { punto: { lat: number; lon: number } | null; medioOnline: boolean; ahora: Date },
): { columnas: ColumnasEnvio; detalle: EnvioDetalle } {
  const estimada = estimarEntrega(a.ahora, r.horario, a.medioOnline);
  return {
    columnas: {
      envioMetodo: r.slug,
      envioZona: r.zona,
      envioPromesa: r.promesa,
      envioEntregaEstimada: estimada.fecha,
    },
    detalle: {
      v: 1,
      metodoId: r.metodoId,
      slug: r.slug,
      zonaId: r.zonaId,
      zona: r.zona,
      precio: r.precio,
      regla: r.regla,
      precision: a.punto ? r.precision : null,
      punto: a.punto ? { lat: a.punto.lat, lon: a.punto.lon } : null,
      // Los feriados vigentes al crear el pedido se congelan con el horario: la fecha real (al confirmar) usa los de ese momento.
      horario: {
        dias: r.horario.dias,
        horaCorte: r.horario.horaCorte,
        margenMin: r.horario.margenMin,
        tz: TZ_ENVIO,
        ...(r.horario.feriados?.length ? { feriados: fechasFeriadas(r.horario.feriados) } : {}),
      },
      alegra: { itemId: r.alegra.itemId, ivaPct: r.alegra.ivaPct },
      avisoFeriados: r.avisoFeriados,
      medioOnline: a.medioOnline,
    },
  };
}

/**
 * El horario congelado de un `envio_detalle` leído de la base, validado (el JSON es un contrato con el
 * CRM): días ISO 1..7 no vacíos, hora de corte "HH:MM" y margen numérico; los feriados son opcionales (pedido anterior sin
 * el campo = ninguno) y se descartan los que no sean fechas válidas. null = no se puede confiar en él
 * (no se calcula ninguna fecha: nunca una fecha inventada).
 */
export function horarioDeDetalle(detalle: unknown): HorarioEnvio | null {
  if (typeof detalle !== "object" || detalle === null) return null;
  const h = (detalle as { horario?: unknown }).horario;
  if (typeof h !== "object" || h === null) return null;
  const { dias, horaCorte, margenMin } = h as { dias?: unknown; horaCorte?: unknown; margenMin?: unknown };
  if (!Array.isArray(dias) || dias.length === 0 || !dias.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return null;
  if (typeof horaCorte !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horaCorte)) return null;
  if (typeof margenMin !== "number" || !Number.isFinite(margenMin) || margenMin < 0) return null;
  const feriados = fechasFeriadas((h as { feriados?: unknown }).feriados);
  return { dias: dias as number[], horaCorte, margenMin, ...(feriados.length > 0 ? { feriados } : {}) };
}

/**
 * ¿La asignación REAL de origen (la de `crearPedido`, dentro de la transacción) sigue cumpliendo la
 * condición de origen del método con el que se cotizó? `real` null = no se puede comprobar (sin
 * sucursales): se acepta.
 */
export function origenCompatible(
  sucursalOrigen: string | null,
  real: { sucursal: string | null; conTraslado: boolean } | null,
): boolean {
  if (!sucursalOrigen || !real) return true;
  return real.sucursal === sucursalOrigen && !real.conTraslado;
}

/**
 * La asignación real de origen (dentro de la transacción de `crearPedido`) ya no cumple la condición
 * del método de envío con el que se cotizó (otra sucursal despacha, o hay líneas a traer). Nada se
 * crea: la ruta responde 409 `envio_cambio` con la cotización nueva (patrón `CuponCanjeError`).
 */
export class EnvioCambioError extends Error {
  constructor(readonly origen: { sucursal: string | null; conTraslado: boolean }) {
    super("el origen del envío cambió");
    this.name = "EnvioCambioError";
  }
}

/** Lo que Mi cuenta muestra del envío por zona de un pedido (todo sale del pedido congelado). */
export interface EnvioPedidoVista {
  zona: string;
  /** "YYYY-MM-DD" estimada al crear el pedido. */
  entregaEstimada: string | null;
  /** "YYYY-MM-DD" fijada al confirmar el pedido; null = todavía no se confirmó. */
  entregaConfirmada: string | null;
  avisoFeriados: string;
  /** El pago es en línea (la promesa del día vale sólo con pago aprobado). */
  medioOnline: boolean;
}

/**
 * Resumen del envío por zona de un pedido para la UI, o null si no tuvo método (retiro, a coordinar,
 * pedido anterior al cambio). Lee `envio_detalle` con cautela: es un JSON con contrato versionado.
 */
export function vistaEnvioDePedido(fila: {
  envioMetodo: string | null;
  envioZona: string | null;
  envioEntregaEstimada: string | null;
  envioEntregaConfirmada: string | null;
  envioDetalle: unknown;
}): EnvioPedidoVista | null {
  if (!fila.envioMetodo || !fila.envioZona) return null;
  const d = typeof fila.envioDetalle === "object" && fila.envioDetalle !== null ? (fila.envioDetalle as Record<string, unknown>) : {};
  return {
    zona: fila.envioZona,
    entregaEstimada: fila.envioEntregaEstimada,
    entregaConfirmada: fila.envioEntregaConfirmada,
    avisoFeriados: typeof d.avisoFeriados === "string" ? d.avisoFeriados.trim() : "",
    medioOnline: d.medioOnline === true,
  };
}
