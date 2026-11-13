/**
 * Lectura del snapshot del envío por zona que el Shop congela en `shop.orders.envio_detalle`
 * (change `envio-por-zona-con-tarifa`). Es un JSON con contrato versionado (`v`), escrito por
 * `apps/clientes/src/lib/envio-snapshot.ts`: acá se lee siempre con cautela, sin asumir la forma.
 *
 * Módulo PURO (sin DB ni reloj).
 */
import type { HorarioEnvio } from "./entrega-fecha"
import { esFechaIso } from "./metodos-envio-horario"

/** Feriados congelados en el pedido: sólo las fechas válidas, ordenadas y sin repetir (campo opcional). */
function feriadosDeHorario(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter(esFechaIso))].sort() : []
}

/**
 * El horario congelado de un `envio_detalle`, validado: días ISO 1..7 no vacíos, hora de corte
 * "HH:MM" y margen numérico; los feriados (opcionales: los pedidos anteriores no los traen) son las fechas
 * "YYYY-MM-DD" válidas que haya. null = no se puede confiar en él (no se calcula ninguna fecha: nunca
 * una fecha inventada). Copia de `horarioDeDetalle` del Shop.
 */
export function horarioDeDetalle(detalle: unknown): HorarioEnvio | null {
  if (typeof detalle !== "object" || detalle === null) return null
  const h = (detalle as { horario?: unknown }).horario
  if (typeof h !== "object" || h === null) return null
  const { dias, horaCorte, margenMin } = h as { dias?: unknown; horaCorte?: unknown; margenMin?: unknown }
  if (!Array.isArray(dias) || dias.length === 0 || !dias.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return null
  if (typeof horaCorte !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horaCorte)) return null
  if (typeof margenMin !== "number" || !Number.isFinite(margenMin) || margenMin < 0) return null
  const feriados = feriadosDeHorario((h as { feriados?: unknown }).feriados)
  return { dias: dias as number[], horaCorte, margenMin, ...(feriados.length > 0 ? { feriados } : {}) }
}

export type ReglaEnvio = "poligono" | "cp" | "georef"

/** Lo que el admin muestra y factura del envío por zona de un pedido. */
export interface EnvioPedido {
  zona: string
  /** Tarifa de la zona con IVA (aunque el envío haya salido gratis). */
  precio: number | null
  regla: ReglaEnvio | null
  /** "calle" = ubicación aproximada (sin altura). */
  precision: "altura" | "calle" | null
  punto: { lat: number; lon: number } | null
  /** Ítem de servicio "Envío" en Alegra y su alícuota, congelados al crear el pedido. */
  alegra: { itemId: string | null; ivaPct: number }
  avisoFeriados: string
  medioOnline: boolean
}

const esNumero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/**
 * Resumen del envío por zona de un pedido, o null si no tuvo método (retiro, a coordinar, pedido
 * anterior al cambio o flag apagado): sin `envio_metodo`/`envio_zona`/detalle no hay nada que mostrar.
 */
export function envioDePedido(fila: {
  envioMetodo: string | null
  envioZona: string | null
  envioDetalle: unknown
}): EnvioPedido | null {
  if (!fila.envioMetodo || !fila.envioZona) return null
  const d = typeof fila.envioDetalle === "object" && fila.envioDetalle !== null ? (fila.envioDetalle as Record<string, unknown>) : null
  if (!d) return null
  const alegra = typeof d.alegra === "object" && d.alegra !== null ? (d.alegra as Record<string, unknown>) : {}
  const itemId = typeof alegra.itemId === "string" && alegra.itemId.trim() ? alegra.itemId.trim() : null
  const regla = d.regla === "poligono" || d.regla === "cp" || d.regla === "georef" ? d.regla : null
  const p = d.punto as { lat?: unknown; lon?: unknown } | null | undefined
  return {
    zona: fila.envioZona,
    precio: esNumero(d.precio) ? d.precio : null,
    regla,
    precision: d.precision === "altura" || d.precision === "calle" ? d.precision : null,
    punto: p && esNumero(p.lat) && esNumero(p.lon) ? { lat: p.lat, lon: p.lon } : null,
    alegra: { itemId, ivaPct: esNumero(alegra.ivaPct) ? alegra.ivaPct : 21 },
    avisoFeriados: typeof d.avisoFeriados === "string" ? d.avisoFeriados.trim() : "",
    medioOnline: d.medioOnline === true,
  }
}
