import type { MedioPagoConAvisos } from "@/lib/medios-pago-shop-repo"

// Lógica pura de la tarjeta de medios de pago (lista de precios, destacado y ficha): arma el
// cuerpo del PATCH y refleja en la lista local lo que el servidor ya hizo (destacar un medio
// desmarca al anterior). Sin React ni DB, para poder probarla.

/** Valor del selector para "Lista por defecto" (el select no admite cadena vacía como opción). */
export const LISTA_POR_DEFECTO = "__defecto__"

export interface PreciosForm {
  idListaPrecios: string
  destacarEnCatalogo: boolean
  mostrarEnFicha: boolean
}

export function cuerpoDePrecios(f: PreciosForm) {
  return {
    idListaPrecios: f.idListaPrecios === LISTA_POR_DEFECTO ? null : f.idListaPrecios,
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
