// Lógica pura de la pestaña "Carritos abandonados" de Pedidos (sin React ni fetch): armado de la
// query, opciones de filtro y formato de antigüedad.

import type { CarritoProductoDto } from "@/lib/carritos-repo"

export const FILTRO_PEDIDO_TODOS = "todos"
export const HORAS_DEFAULT = 1
export const DIAS_DEFAULT = 30

export const ROTULO_MONTO = "Monto referencial (precio general de la web, con IVA; puede diferir del que verá en el pago)"
export const NOTA_MONTO = "No considera precios por medio de pago ni listas propias de la cuenta."
export const NOTA_SESION = "Solo se muestran compradores con sesión iniciada."
export const VACIO = "No hay carritos abandonados para mostrar"
export const CLIENTE_ELIMINADO = "Cliente eliminado"

export const OPCIONES_HORAS = [
  { value: "1", label: "Más de 1 hora" },
  { value: "6", label: "Más de 6 horas" },
  { value: "24", label: "Más de 24 horas" },
  { value: "72", label: "Más de 72 horas" },
]

export const OPCIONES_DIAS = [
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
]

export const OPCIONES_PEDIDO = [
  { value: FILTRO_PEDIDO_TODOS, label: "Todos los carritos" },
  { value: "sin_pedido", label: "Solo abandono (sin pedido pendiente)" },
  { value: "con_pedido_pendiente", label: "Con pedido pendiente de pago" },
]

export interface FiltrosCarritos {
  horas?: number
  dias?: number
  pedido?: string
  q?: string
}

export function queryCarritos(input: FiltrosCarritos & { start: number; limit: number }): string {
  const params = new URLSearchParams({
    horas: String(input.horas ?? HORAS_DEFAULT),
    dias: String(input.dias ?? DIAS_DEFAULT),
  })
  if (input.pedido && input.pedido !== FILTRO_PEDIDO_TODOS) params.set("pedido", input.pedido)
  const q = input.q?.trim()
  if (q) params.set("q", q)
  params.set("start", String(Math.max(0, Math.trunc(input.start))))
  params.set("limit", String(input.limit))
  return params.toString()
}

/** Horas de inactividad → "menos de 1 hora" / "3 horas" / "2 días". */
export function textoInactividad(horas: number): string {
  if (!Number.isFinite(horas) || horas < 1) return "menos de 1 hora"
  if (horas < 48) {
    const h = Math.floor(horas)
    return h === 1 ? "1 hora" : `${h} horas`
  }
  return `${Math.floor(horas / 24)} días`
}

/** "Nombre Apellido" / email / "Cliente sin nombre". */
export function nombreCliente(c: { nombre: string | null; email: string | null }): string {
  return c.nombre?.trim() || c.email?.trim() || "Cliente sin nombre"
}

/** Una línea de la celda de productos: "2 × Nombre" y, si lo tiene, el código debajo. */
export interface LineaProducto {
  texto: string
  codigo: string | null
}

/**
 * Resumen de productos para la celda: los primeros (hasta 3) con su cantidad y código, y un
 * "y N más" si el carrito tiene más líneas de las que se traen.
 */
export function resumenProductos(productos: readonly CarritoProductoDto[], lineas: number): LineaProducto[] {
  const filas: LineaProducto[] = productos.map((p) => ({
    texto: `${p.qty} × ${p.nombre?.trim() || "Producto no disponible"}`,
    codigo: p.codigo?.trim() || null,
  }))
  const resto = lineas - productos.length
  if (resto > 0) filas.push({ texto: `y ${resto} más`, codigo: null })
  return filas
}
