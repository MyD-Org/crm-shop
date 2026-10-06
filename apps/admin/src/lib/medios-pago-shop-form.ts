import type { MedioPagoConAvisos } from "@/lib/medios-pago-shop-repo"

// Lógica pura de la tarjeta de medios de pago (lista de precios, destacado y ficha): arma el
// cuerpo del PATCH y refleja en la lista local lo que el servidor ya hizo (destacar un medio
// desmarca al anterior). Sin React ni DB, para poder probarla.

/** Valor del selector para "Lista de referencia" (el select no admite cadena vacía como opción). */
export const LISTA_POR_DEFECTO = "__defecto__"

export interface PreciosForm {
  destacarEnCatalogo: boolean
  mostrarEnFicha: boolean
}

export function cuerpoDePrecios(f: PreciosForm) {
  return {
    destacarEnCatalogo: f.destacarEnCatalogo,
    mostrarEnFicha: f.mostrarEnFicha,
  }
}

const porOrden = (a: MedioPagoConAvisos, b: MedioPagoConAvisos) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)

/** Incorpora el medio guardado; si quedó destacado, ningún otro lo está. */
export function aplicarMedioGuardado(medios: MedioPagoConAvisos[], nuevo: MedioPagoConAvisos): MedioPagoConAvisos[] {
  return [
    ...medios
      .filter((m) => m.slug !== nuevo.slug)
      .map((m) => (nuevo.destacarEnCatalogo && m.destacarEnCatalogo ? { ...m, destacarEnCatalogo: false } : m)),
    nuevo,
  ].sort(porOrden)
}

// --- Cuotas sin interés (rebanada D) ---

/** Una fila del editor de cuotas: la cantidad tal como se escribe y la lista elegida. */
export interface FilaCuotasForm {
  cuotas: string
  listaId: string
}

export interface CondicionCuotasForm {
  cuotas: number
  listaId: string
}

/** Valida las filas del editor: cantidades enteras de 2 a 24, con lista y sin repetir. Errores en usted. */
export function validarFilasCuotas(
  filas: readonly FilaCuotasForm[],
): { ok: true; filas: CondicionCuotasForm[] } | { ok: false; error: string } {
  const salida: CondicionCuotasForm[] = []
  for (const f of filas) {
    const texto = f.cuotas.trim()
    const n = /^\d+$/.test(texto) ? Number(texto) : NaN
    if (!Number.isInteger(n) || n < 2 || n > 24) {
      return { ok: false, error: "Indique una cantidad de cuotas entera, de 2 a 24." }
    }
    if (!f.listaId) return { ok: false, error: "Seleccione la lista de precios de cada cantidad de cuotas." }
    if (salida.some((x) => x.cuotas === n)) return { ok: false, error: `No puede repetir la cantidad de cuotas: ${n}.` }
    salida.push({ cuotas: n, listaId: f.listaId })
  }
  return { ok: true, filas: salida.sort((a, b) => a.cuotas - b.cuotas) }
}

/**
 * Cambios de precios (`setCondicion`) que llevan las condiciones de cuotas actuales a las deseadas:
 * altas y cambios de lista primero, bajas al final (`listaId: null`). Lo que no cambia no genera nada.
 */
export function cambiosDeCuotas(
  medioSlug: string,
  actuales: readonly CondicionCuotasForm[],
  deseadas: readonly CondicionCuotasForm[],
) {
  const cambios: { op: "setCondicion"; medioSlug: string; cuotas: number; listaId: string | null }[] = []
  for (const d of deseadas) {
    if (actuales.find((a) => a.cuotas === d.cuotas)?.listaId !== d.listaId) {
      cambios.push({ op: "setCondicion", medioSlug, cuotas: d.cuotas, listaId: d.listaId })
    }
  }
  for (const a of actuales) {
    if (!deseadas.some((d) => d.cuotas === a.cuotas)) {
      cambios.push({ op: "setCondicion", medioSlug, cuotas: a.cuotas, listaId: null })
    }
  }
  return cambios
}
