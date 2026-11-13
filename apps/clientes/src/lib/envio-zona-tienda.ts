/**
 * Datos del «Envío rápido» que sólo conoce el Shop (change `envio-rapido`): el horario de entrega y los
 * feriados que el CRM guarda en `public.metodos_envio.config` (`horarioEntrega`, `feriados`). Se declaran acá,
 * y no en `envio-zona.ts`, porque ese módulo puro está duplicado byte a byte con el del CRM.
 */
import type { HorarioEnvio } from "./entrega-fecha";
import type { MetodoEnvio, ResultadoMetodo } from "./envio-zona";

export const MAX_HORARIO_ENTREGA = 40;
export const MAX_FERIADOS = 60;

/** Método de envío leído del CRM, con el horario de entrega («antes de las 21 hs») y los feriados (ausentes = ninguno). */
export type MetodoEnvioTienda = MetodoEnvio & { horarioEntrega?: string; feriados?: string[] };

/** Resultado de cotizar un método, con el horario de entrega y los feriados del método. */
export type ResultadoMetodoTienda = ResultadoMetodo & { horarioEntrega?: string; horario: { feriados?: string[] } };

/**
 * `config.horarioEntrega` de la fila del CRM. Defensivo: cualquier cosa que no sea un texto no vacío de hasta
 * 40 caracteres es «sin horario» (el JSON lo escribe otro sistema; nunca rompe la tienda).
 */
export function horarioEntregaDeConfig(config: unknown): string | undefined {
  if (typeof config !== "object" || config === null) return undefined;
  const v = (config as Record<string, unknown>).horarioEntrega;
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t && t.length <= MAX_HORARIO_ENTREGA ? t : undefined;
}

/** ¿Es "YYYY-MM-DD" y una fecha real del calendario? */
export function esFechaIso(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (y < 2000 || y > 2100) return false;
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** Fechas válidas de una lista, ordenadas y sin repetir (lo inválido se descarta, nunca rompe). */
export function fechasFeriadas(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter(esFechaIso))].sort() : [];
}

/** `config.feriados` de la fila del CRM: hasta 60 fechas válidas, ordenadas y sin repetir. */
export function feriadosDeConfig(config: unknown): string[] {
  if (typeof config !== "object" || config === null) return [];
  return fechasFeriadas((config as Record<string, unknown>).feriados).slice(0, MAX_FERIADOS);
}

/** Horario operativo del método para calcular fechas, con sus feriados si los tiene. */
export function horarioDeMetodo(m: MetodoEnvioTienda): HorarioEnvio {
  return {
    dias: m.diasOperativos,
    horaCorte: m.horaCorte,
    margenMin: m.margenMin,
    ...(m.feriados?.length ? { feriados: m.feriados } : {}),
  };
}

/** Suma al resultado de cotizar un método lo que sólo guarda `config`: horario de entrega y feriados. */
export function conDatosDeTienda(r: ResultadoMetodo, m: MetodoEnvioTienda): ResultadoMetodoTienda {
  if (!m.horarioEntrega && !m.feriados?.length) return r;
  return {
    ...r,
    ...(m.horarioEntrega ? { horarioEntrega: m.horarioEntrega } : {}),
    horario: { ...r.horario, ...(m.feriados?.length ? { feriados: m.feriados } : {}) },
  };
}
