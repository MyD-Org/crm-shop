import type { MedioPagoConAvisos } from "@/lib/medios-pago-shop-repo"
import { OPCIONES_COBRO, type OpcionCobro } from "@/lib/medios-pago-shop-opciones"
import { ordenarMarcas } from "@/lib/marcas-tarjeta"
import { MSG_MARCAS_VACIAS } from "@/lib/precios-online-cambios"

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

/**
 * Formas de pago del cobro en línea: van en el PATCH sólo si cambiaron, para que editar otro dato
 * de un medio no dispare la validación de opciones con lo que ya estaba guardado.
 */
export function cuerpoDeOpciones(
  deseadas: readonly OpcionCobro[],
  actuales: readonly OpcionCobro[],
): { opcionesCobro?: OpcionCobro[] } {
  const iguales = deseadas.length === actuales.length && deseadas.every((o) => actuales.includes(o))
  return iguales ? {} : { opcionesCobro: OPCIONES_COBRO.filter((o) => deseadas.includes(o)) }
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
  /** "Desde $" (con impuestos), tal como se escribe; vacío o ausente = sin mínimo. */
  montoMinimo?: string
  /** Tarjetas: null o ausente = "Todas"; arreglo = "Elegir" (vacío es un error). */
  marcas?: string[] | null
}

export interface CondicionCuotasForm {
  cuotas: number
  listaId: string
  /** Texto numérico con dos decimales; null = sin mínimo. */
  montoMinimo: string | null
  /** Ids de marcas-tarjeta.ts en el orden de la lista; null = todas. */
  marcas: string[] | null
}

const MSG_MONTO = "Indique un monto válido, igual o mayor que cero, o deje 'Desde $' vacío."

/** "60000", "60000,5" o "60000.50" -> "60000.50"; vacío -> null; cualquier otra cosa -> undefined. */
function montoDeFila(texto: string | undefined): string | null | undefined {
  const t = (texto ?? "").trim()
  if (t === "") return null
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return undefined
  return Number(t.replace(",", ".")).toFixed(2)
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
    const montoMinimo = montoDeFila(f.montoMinimo)
    if (montoMinimo === undefined) return { ok: false, error: MSG_MONTO }
    if (f.marcas && f.marcas.length === 0) return { ok: false, error: MSG_MARCAS_VACIAS }
    salida.push({ cuotas: n, listaId: f.listaId, montoMinimo, marcas: f.marcas ? ordenarMarcas(f.marcas) : null })
  }
  return { ok: true, filas: salida.sort((a, b) => a.cuotas - b.cuotas) }
}

/**
 * Cambios de precios (`setCondicion`) que llevan las condiciones de cuotas actuales a las deseadas:
 * altas y cambios de lista primero, bajas al final (`listaId: null`). Lo que no cambia no genera nada.
 * Cada alta o cambio lleva mínimo y tarjetas completos: `setCondicion` reemplaza la fila entera.
 */
export function cambiosDeCuotas(
  medioSlug: string,
  actuales: readonly CondicionCuotasForm[],
  deseadas: readonly CondicionCuotasForm[],
) {
  const cambios: {
    op: "setCondicion"
    medioSlug: string
    cuotas: number
    listaId: string | null
    montoMinimo?: string | null
    marcas?: string[] | null
  }[] = []
  for (const d of deseadas) {
    const a = actuales.find((x) => x.cuotas === d.cuotas)
    if (a?.listaId !== d.listaId || (a.montoMinimo ?? null) !== d.montoMinimo || clave(a.marcas) !== clave(d.marcas)) {
      cambios.push({
        op: "setCondicion",
        medioSlug,
        cuotas: d.cuotas,
        listaId: d.listaId,
        montoMinimo: d.montoMinimo,
        marcas: d.marcas,
      })
    }
  }
  for (const a of actuales) {
    if (!deseadas.some((d) => d.cuotas === a.cuotas)) {
      cambios.push({ op: "setCondicion", medioSlug, cuotas: a.cuotas, listaId: null })
    }
  }
  return cambios
}

/** Clave comparable de unas tarjetas: "" = todas; si no, ids en el orden de la lista. */
function clave(marcas: readonly string[] | null | undefined): string {
  return marcas ? `:${ordenarMarcas(marcas).join(",")}` : ""
}

// --- Listas por forma de pago (0076, sólo Mercado Pago y Payway) ---

/** Valor del selector de una forma para "Igual que la lista del medio" (hereda la fila de todas las formas). */
export const LISTA_IGUAL_QUE_EL_MEDIO = "__igual__"

/** Lista elegida por forma: el id de la lista o `LISTA_IGUAL_QUE_EL_MEDIO`. Una forma ausente = sin lista propia. */
export type ListasPorFormaForm = Partial<Record<OpcionCobro, string>>

/** Estado inicial del editor a partir de lo guardado en el medio. */
export function listasPorFormaDesdeDto(guardadas: readonly { forma: OpcionCobro; listaId: string }[]): ListasPorFormaForm {
  return Object.fromEntries(guardadas.map((g) => [g.forma, g.listaId]))
}

/**
 * Cambios de precios (`setCondicion` con forma) que llevan las listas por forma actuales a las deseadas:
 * altas y cambios primero, bajas (`listaId: null`) al final. Lo que no cambia no genera nada. Una forma
 * ausente o en `LISTA_IGUAL_QUE_EL_MEDIO` es "sin fila propia".
 */
export function cambiosDeListasPorForma(
  medioSlug: string,
  actuales: ListasPorFormaForm,
  deseadas: ListasPorFormaForm,
) {
  const propia = (v: string | undefined) => (v && v !== LISTA_IGUAL_QUE_EL_MEDIO ? v : null)
  const altas: { op: "setCondicion"; medioSlug: string; cuotas: null; forma: OpcionCobro; listaId: string | null }[] = []
  const bajas: typeof altas = []
  for (const forma of OPCIONES_COBRO) {
    const antes = propia(actuales[forma])
    const despues = propia(deseadas[forma])
    if (antes === despues) continue
    const cambio = { op: "setCondicion" as const, medioSlug, cuotas: null, forma, listaId: despues }
    if (despues === null) bajas.push(cambio)
    else altas.push(cambio)
  }
  return [...altas, ...bajas]
}
