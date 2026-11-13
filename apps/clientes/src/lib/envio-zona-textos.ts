/**
 * Textos y estimaciones de UI del envío por zona (change `envio-por-zona-con-tarifa`, flag
 * `envio-por-zona`). Módulo PURO, en español formal de usted (no pasa por el chat IA, que usa registro
 * neutro). Lo usan la ficha (servidor), el carrito y el checkout (cliente).
 */
import { fmtPesosEnteros } from "./format";
import { fechaEntrega, type FechaEntrega, type HorarioEnvio } from "./entrega-fecha";
import { estimarEntrega } from "./envio-snapshot";
import { estimarPorLocalidad, type MetodoEnvio } from "./envio-zona";
import { claveProvincia } from "./sucursales";
import { claveTexto } from "./texto-clave";

export const TEXTOS_ENVIO_ZONA = {
  /** Etiqueta del método cuando no tiene un nombre mejor. */
  enElDia: "Envío en el día",
  sinUbicar: "Seleccione su dirección de la lista para calcular el envío en el día.",
  continuarACoordinar: "Continuar con envío a coordinar",
  volverAUbicar: "Elegir una dirección de la lista",
  aCoordinarElegido: "Elegió continuar con el envío a coordinar. Un asesor se comunicará para acordar el costo.",
  pagoConfirmado: "a partir de la confirmación de su pago",
  precioCambio: "El costo de envío cambió según su dirección. Revise el nuevo total antes de confirmar.",
  direccionAproximada: "Su dirección se ubicó de forma aproximada. Seleccione una sugerencia con número para ver el costo exacto.",
} as const;

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "YYYY-MM-DD" → día de la semana (calendario civil, sin zona horaria). */
function diaDeSemana(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "YYYY-MM-DD" → "16/11". */
function diaMes(fecha: string): string {
  const [, m, d] = fecha.split("-");
  return `${Number(d)}/${Number(m)}`;
}

/**
 * Cuándo llega, para mostrar. `hoy` es la fecha civil argentina de "ahora" (para decir «hoy» y «mañana»).
 * "Llega hoy", "Llega mañana", "Llega el lunes 16/11".
 */
export function textoLlegada(entrega: FechaEntrega, manana: string): string {
  if (entrega.mismoDia) return "Llega hoy";
  if (entrega.fecha === manana) return "Llega mañana";
  return `Llega el ${diaDeSemana(entrega.fecha)} ${diaMes(entrega.fecha)}`;
}

/** Fecha civil argentina del día siguiente a `ahora`. */
function mananaDe(ahora: Date): string {
  // Con todos los días operativos y corte 00:00 «hoy» nunca alcanza: la primera fecha es la de mañana.
  return fechaEntrega(ahora, { dias: [1, 2, 3, 4, 5, 6, 7], horaCorte: "00:00", margenMin: 0 }).fecha;
}

export interface LlegadaEstimada {
  /** "Llega hoy" / "Llega mañana" / "Llega el lunes 16/11". */
  texto: string;
  /** Sólo se promete el mismo día si el pago es en línea y llega antes del corte. */
  mismoDia: boolean;
  /** Aclaración sobre el corte: «si confirma su pago antes de las 09:00». */
  condicion: string | null;
}

/**
 * Estimación de cuándo llega, con el horario del método. Es sólo una estimación para mostrar: la fecha
 * real se fija al confirmar (primer evento de confirmación del pedido). Sin pago en línea nunca se
 * promete el mismo día (`estimarEntrega`).
 */
export function llegadaEstimada(horario: HorarioEnvio, ahora: Date, medioOnline = true): LlegadaEstimada {
  const e = estimarEntrega(ahora, horario, medioOnline);
  const condicion = e.mismoDia
    ? `si confirma su pago antes de las ${horario.horaCorte.slice(0, 5)}`
    : null;
  return { texto: textoLlegada(e, mananaDe(ahora)), mismoDia: e.mismoDia, condicion };
}

export interface EstimadoFicha {
  tipo: "exacto" | "desde";
  precio: number;
  /** "Envío en el día: $4.500" / "Envío en el día desde $4.500". */
  texto: string;
  llegada: LlegadaEstimada;
  avisoFeriados: string;
  metodo: string;
}

export function textoPrecioEstimado(nombre: string, tipo: "exacto" | "desde", precio: number): string {
  return tipo === "desde" ? `${nombre} desde ${fmtPesosEnteros(precio)}` : `${nombre}: ${fmtPesosEnteros(precio)}`;
}

/**
 * Lo que se puede anticipar de un envío por zona sabiendo sólo la LOCALIDAD del visitante (ficha y carrito).
 * Toma el primer método activo (por `orden`) de la provincia que atiende esa localidad; null = ninguno:
 * quedan los textos de siempre. La geometría nunca llega al navegador: esto corre en el servidor.
 */
export function estimarEnvioPorLocalidad(
  metodos: MetodoEnvio[] | undefined,
  ubicacion: { localidad: string; provincia: string; id?: string } | null,
  ahora: Date,
): EstimadoFicha | null {
  if (!ubicacion || !metodos?.length) return null;
  const provincia = claveProvincia(ubicacion.provincia);
  const nombre = claveTexto(ubicacion.localidad);
  const ordenados = [...metodos].filter((m) => m.activo && m.provinciaClave === provincia).sort((a, b) => a.orden - b.orden);
  for (const m of ordenados) {
    const loc = m.localidades?.find((l) => (ubicacion.id && l.georefId === ubicacion.id) || (nombre && l.nombreNorm === nombre));
    if (!loc) continue;
    const e = estimarPorLocalidad(m, loc);
    if (!e) continue;
    return {
      tipo: e.tipo,
      precio: e.precio,
      texto: textoPrecioEstimado(TEXTOS_ENVIO_ZONA.enElDia, e.tipo, e.precio),
      llegada: llegadaEstimada({ dias: m.diasOperativos, horaCorte: m.horaCorte, margenMin: m.margenMin }, ahora),
      avisoFeriados: m.avisoFeriados.trim(),
      metodo: m.nombre,
    };
  }
  return null;
}
