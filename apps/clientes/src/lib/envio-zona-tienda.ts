/**
 * Datos del «Envío rápido» que sólo conoce el Shop (change `envio-rapido`): el horario de entrega que el CRM
 * guarda en `public.metodos_envio.config.horarioEntrega`. Se declaran acá, y no en `envio-zona.ts`, porque
 * ese módulo puro está duplicado byte a byte con el del CRM.
 */
import type { MetodoEnvio, ResultadoMetodo } from "./envio-zona";

export const MAX_HORARIO_ENTREGA = 40;

/** Método de envío leído del CRM, con el horario de entrega («antes de las 21 hs»; ausente = sin horario). */
export type MetodoEnvioTienda = MetodoEnvio & { horarioEntrega?: string };

/** Resultado de cotizar un método, con el horario de entrega del método. */
export type ResultadoMetodoTienda = ResultadoMetodo & { horarioEntrega?: string };

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
