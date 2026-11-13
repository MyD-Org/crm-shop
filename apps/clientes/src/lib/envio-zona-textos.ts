/**
 * Textos y estimaciones de UI del envío por zona (change `envio-por-zona-con-tarifa`, flag
 * `envio-por-zona`). Módulo PURO, en español formal de usted (no pasa por el chat IA, que usa registro
 * neutro). Lo usan la ficha (servidor), el carrito y el checkout (cliente).
 */
import { fmtPesosEnteros } from "./format";
import { TZ_ENVIO, fechaEntrega, type FechaEntrega, type HorarioEnvio } from "./entrega-fecha";
import { estimarEntrega } from "./envio-snapshot";
import { cotizarMetodo, estimarPorLocalidad, type DestinoEnvio, type MetodoEnvio } from "./envio-zona";
import { horarioDeMetodo, type MetodoEnvioTienda } from "./envio-zona-tienda";
import { claveProvincia } from "./sucursales";
import { claveTexto } from "./texto-clave";

export const TEXTOS_ENVIO_ZONA = {
  /** Mi cuenta: el pedido congelado no guarda el nombre del método, sólo su zona. */
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

/** "YYYY-MM-DD" → "lunes 16/11". */
export function fechaCorta(fecha: string): string {
  return `${diaDeSemana(fecha)} ${diaMes(fecha)}`;
}

/**
 * Línea de entrega de un pedido ya creado, para Mi cuenta. Con la fecha confirmada es la que vale; antes
 * es una estimación que cuenta desde la confirmación del pago. Sin fechas, null.
 */
export function textoEntregaPedido(e: {
  entregaEstimada: string | null;
  entregaConfirmada: string | null;
  medioOnline: boolean;
}): string | null {
  if (e.entregaConfirmada) return `Entrega prevista: ${fechaCorta(e.entregaConfirmada)}`;
  if (e.entregaEstimada) {
    return `Entrega estimada: ${fechaCorta(e.entregaEstimada)}, ${TEXTOS_ENVIO_ZONA.pagoConfirmado}`;
  }
  return null;
}

/** Minutos que faltan para el corte del día (hora local de Argentina, descontado el margen). */
function minutosHastaCorte(ahora: Date, horario: HorarioEnvio): number {
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: TZ_ENVIO, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(ahora);
  const n = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  const [hc, mc] = horario.horaCorte.split(":").map(Number);
  return hc * 60 + mc - (horario.margenMin ?? 0) - (n("hour") * 60 + n("minute"));
}

/**
 * Como Mercado Libre: «Comprando dentro de las próximas 2 h 15 min» / «… de los próximos 40 min». Sin
 * minutos (justo en el corte) no se promete nada.
 */
export function textoCuentaRegresiva(minutos: number): string | null {
  if (!Number.isFinite(minutos) || minutos <= 0) return null;
  if (minutos < 60) return `Comprando dentro de los próximos ${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `Comprando dentro de las próximas ${h} h${m ? ` ${m} min` : ""}`;
}

/**
 * «Llega hoy» + horario de entrega del método («antes de las 21 hs») y, si se pasa, el precio:
 * «Llega hoy antes de las 21 hs por $ 4.490». Sin horario: «Llega el lunes 16/11 por $ 4.490».
 */
export function textoLineaLlegada(llegada: string, horarioEntrega?: string, precio?: number): string {
  const h = horarioEntrega?.trim();
  return [llegada, h, precio === undefined ? null : `por ${fmtPesosEnteros(precio)}`].filter(Boolean).join(" ");
}

export interface LlegadaEstimada {
  /** "Llega hoy antes de las 21 hs" / "Llega mañana" / "Llega el lunes 16/11 antes de las 21 hs". */
  texto: string;
  /** Sólo se promete el mismo día si el pago es en línea y llega antes del corte. */
  mismoDia: boolean;
  /** Cuenta regresiva al corte, estilo Mercado Libre: «Comprando dentro de las próximas 2 h 15 min». */
  condicion: string | null;
}

/**
 * Estimación de cuándo llega, con el horario del método. Es sólo una estimación para mostrar: la fecha
 * real se fija al confirmar (primer evento de confirmación del pedido). Sin pago en línea nunca se
 * promete el mismo día (`estimarEntrega`).
 */
export function llegadaEstimada(horario: HorarioEnvio, ahora: Date, medioOnline = true, horarioEntrega?: string): LlegadaEstimada {
  const e = estimarEntrega(ahora, horario, medioOnline);
  const condicion = e.mismoDia ? textoCuentaRegresiva(minutosHastaCorte(ahora, horario)) : null;
  return { texto: textoLineaLlegada(textoLlegada(e, mananaDe(ahora)), horarioEntrega), mismoDia: e.mismoDia, condicion };
}

export interface EstimadoFicha {
  tipo: "exacto" | "desde";
  precio: number;
  /** Línea principal: «Llega hoy antes de las 21 hs por $ 4.490»; con «desde» (varias zonas) sin precio. */
  texto: string;
  /** Con «desde»: las tarifas de las zonas activas del método, de menor a mayor, para mostrarlas todas. */
  zonas?: { nombre: string; precio: number }[];
  llegada: LlegadaEstimada;
  avisoFeriados: string;
  /** Nombre del método (el que va en el cartel). */
  metodo: string;
}

/** Tarifas de las zonas activas (una por nombre), de menor a mayor. Sin geometría: sólo nombre y precio. */
function tarifasDeZonas(m: MetodoEnvio): { nombre: string; precio: number }[] {
  const vistas = new Set<string>();
  return m.zonas
    .filter((z) => z.activa)
    .sort((a, b) => a.precio - b.precio)
    .filter((z) => (vistas.has(z.nombre) ? false : (vistas.add(z.nombre), true)))
    .map((z) => ({ nombre: z.nombre, precio: z.precio }));
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
  metodos: MetodoEnvioTienda[] | undefined,
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
    const llegada = llegadaEstimada(horarioDeMetodo(m), ahora, true, m.horarioEntrega);
    return {
      tipo: e.tipo,
      precio: e.precio,
      texto: textoLineaLlegada(llegada.texto, undefined, e.tipo === "exacto" ? e.precio : undefined),
      ...(e.tipo === "desde" ? { zonas: tarifasDeZonas(m) } : {}),
      llegada,
      avisoFeriados: m.avisoFeriados.trim(),
      metodo: m.nombre,
    };
  }
  return null;
}

/**
 * Tarifa EXACTA de un punto ya verificado por el servidor (ficha y carrito con «Usar mi ubicación»): la zona
 * que lo contiene, por el primer método activo (por `orden`) que lo resuelve con las mismas reglas que el
 * pedido. null = ninguna zona lo alcanza: costo a coordinar. La geometría nunca llega al navegador.
 */
export function estimarEnvioPorPunto(
  metodos: MetodoEnvioTienda[] | undefined,
  destino: DestinoEnvio,
  ahora: Date,
): EstimadoFicha | null {
  if (!destino.punto || !metodos?.length) return null;
  const ordenados = [...metodos].filter((m) => m.activo).sort((a, b) => a.orden - b.orden);
  for (const m of ordenados) {
    const r = cotizarMetodo(m, destino, { origen: null, subtotalSinIva: 0, gratisTienda: false, gratisCupon: false });
    if (!r) continue;
    const llegada = llegadaEstimada(horarioDeMetodo(m), ahora, true, m.horarioEntrega);
    return {
      tipo: "exacto",
      precio: r.precio,
      texto: textoLineaLlegada(llegada.texto, undefined, r.precio),
      llegada,
      avisoFeriados: m.avisoFeriados.trim(),
      metodo: m.nombre,
    };
  }
  return null;
}
