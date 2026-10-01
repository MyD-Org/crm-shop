/**
 * Freno del botón "Leer ficha técnica" (cada lectura es una llamada paga a Claude Haiku):
 *
 * - **En curso por producto**: mientras una lectura de (tenant, producto) no terminó, otra del
 *   mismo producto se rechaza (doble clic, dos pestañas). Se libera siempre, termine bien o mal.
 * - **Tope por tenant**: a lo sumo `MAX_LECTURAS_POR_MINUTO` lecturas por ventana fija de un
 *   minuto (mismo patrón que `permitir()` del Shop).
 *
 * En memoria del proceso: NO es distribuido (con N instancias el tope efectivo es N veces). Alcanza
 * para frenar clics repetidos, que es lo que tiene que frenar; el lote masivo es un script aparte.
 */

export const MAX_LECTURAS_POR_MINUTO = 10
const VENTANA_MS = 60_000

const enCurso = new Set<string>()
const ventanas = new Map<string, { hasta: number; usos: number }>()

export type Permiso = { ok: true; liberar: () => void } | { ok: false; motivo: "en_curso" | "limite" }

/** Pide permiso para leer la ficha de un producto. Con `ok`, hay que llamar a `liberar()` al terminar. */
export function tomarLectura(tenantId: string, alegraId: string, ahora: number = Date.now()): Permiso {
  const clave = `${tenantId}|${alegraId}`
  if (enCurso.has(clave)) return { ok: false, motivo: "en_curso" }

  const v = ventanas.get(tenantId)
  if (v && v.hasta > ahora && v.usos >= MAX_LECTURAS_POR_MINUTO) return { ok: false, motivo: "limite" }
  if (!v || v.hasta <= ahora) ventanas.set(tenantId, { hasta: ahora + VENTANA_MS, usos: 1 })
  else v.usos++

  enCurso.add(clave)
  let liberado = false
  return {
    ok: true,
    liberar: () => {
      if (liberado) return
      liberado = true
      enCurso.delete(clave)
    },
  }
}

/** Sólo tests. */
export function reiniciarGuardaLectura(): void {
  enCurso.clear()
  ventanas.clear()
}
