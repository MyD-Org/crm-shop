import type { AlegraPriceList } from "./alegra"

// Listas de precio de Alegra al dar de alta un producto desde Compras (change `compras-en-transito`,
// S4b). Cada lista de la cuenta se carga en el mismo alta: precio NETO (sin IVA) = costo × (1 + %).
// Los porcentajes por defecto son los multiplicadores que se usan para cargar productos de proveedores
// (L1 ×1,6, L2 ×1,4, L5 ×1,25, PROMOCION EFECTIVO ×1,3; la General igual que L1). Se reconocen por el
// NOMBRE de la lista —los ids son por cuenta y no se hardcodean—. Una lista activa sin coeficiente
// conocido bloquea el alta: nunca se deja una lista en 0.

export const PORCENTAJES_POR_DEFECTO: Record<string, number> = {
  L1: 60,
  "1": 60,
  "2": 40,
  "5": 25,
  GENERAL: 60,
  L2: 40,
  L5: 25,
  PROMOCIONEFECTIVO: 30,
}

const normalizarNombre = (nombre: string): string =>
  nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/^LISTA/, "")
    .replace(/[^A-Z0-9]/g, "")

export const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export const precioDesdePorcentaje = (costo: number, porcentaje: number): number => redondear2(costo * (1 + porcentaje / 100))

export const porcentajeDesdePrecio = (costo: number, precio: number): number => redondear2((precio / costo - 1) * 100)

export interface ListaConPrecio {
  id: string
  nombre: string
  porcentajeDefecto: number
  porcentaje: number
  precio: number
}

export type ResultadoListas = { ok: true; listas: ListaConPrecio[] } | { ok: false; error: string }

/** Listas activas de la cuenta con su % por defecto y el precio resultante sobre `costo`. */
export function listasConDefecto(listasCuenta: AlegraPriceList[], costo: number, cuentaNombre: string): ResultadoListas {
  const activas = listasCuenta.filter((l) => l.status === "active")
  const desconocidas = activas.filter((l) => PORCENTAJES_POR_DEFECTO[normalizarNombre(l.name)] === undefined)
  if (desconocidas.length > 0) {
    return {
      ok: false,
      error: `No se puede dar de alta el producto: la cuenta de ${cuentaNombre} tiene listas de precio sin coeficiente definido (${desconocidas.map((l) => `"${l.name}"`).join(", ")}). Defina su coeficiente antes de continuar.`,
    }
  }
  if (activas.length === 0) return { ok: false, error: `La cuenta de ${cuentaNombre} no tiene listas de precio activas.` }
  return {
    ok: true,
    listas: activas.map((l) => {
      const pct = PORCENTAJES_POR_DEFECTO[normalizarNombre(l.name)]
      return { id: l.alegraId, nombre: l.name, porcentajeDefecto: pct, porcentaje: pct, precio: precioDesdePorcentaje(costo, pct) }
    }),
  }
}

export interface PrecioElegido {
  id: string
  precio: number
}

export type ResultadoPreciosElegidos = { ok: true; listas: ListaConPrecio[] } | { ok: false; error: string }

/**
 * Valida los precios que eligió el operador contra las listas ACTUALES de la cuenta: deben estar
 * todas, una vez cada una, con precio finito > 0. El % de cada lista se deriva del precio.
 */
export function aplicarPreciosElegidos(
  listasCuenta: AlegraPriceList[],
  costo: number,
  elegidos: PrecioElegido[],
  cuentaNombre: string,
): ResultadoPreciosElegidos {
  const base = listasConDefecto(listasCuenta, costo, cuentaNombre)
  if (!base.ok) return base
  const porId = new Map(elegidos.map((e) => [e.id, e.precio]))
  if (porId.size !== elegidos.length || elegidos.length !== base.listas.length || base.listas.some((l) => !porId.has(l.id))) {
    return { ok: false, error: "Los precios no coinciden con las listas de la cuenta. Vuelva a abrir el formulario e inténtelo nuevamente." }
  }
  const listas: ListaConPrecio[] = []
  for (const l of base.listas) {
    const precio = porId.get(l.id)!
    if (!Number.isFinite(precio) || precio <= 0) return { ok: false, error: `Indique un precio mayor a cero para la lista "${l.nombre}".` }
    const p = redondear2(precio)
    listas.push({ ...l, precio: p, porcentaje: porcentajeDesdePrecio(costo, p) })
  }
  return { ok: true, listas }
}

/** Listas cuyo % difiere del por defecto: las únicas que se guardan como ajuste del producto. */
export const listasConAjuste = (listas: ListaConPrecio[]): ListaConPrecio[] =>
  listas.filter((l) => Math.abs(l.porcentaje - l.porcentajeDefecto) >= 0.005)
