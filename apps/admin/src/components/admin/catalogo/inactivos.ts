import type { MotivoNoPublicado } from "@/lib/catalogo-overlay"
import type { Filtros } from "./tipos"

/** Filtros con los que abre (y a los que vuelve «Limpiar filtros») el listado de productos. */
export const FILTROS_INICIALES: Filtros = {
  estado: "oculto",
  foto: "con",
  alegra: "active",
  precio: "con",
  stock: "con",
}

/** true = el listado incluye los dados de baja en Alegra (todos o sólo ellos). */
export const verInactivos = (f: Filtros): boolean => f.alegra !== "active"

/** «Ver también los inactivos»: encendido quita el filtro; apagado vuelve a ocultarlos. */
export function conInactivos(f: Filtros, ver: boolean): Filtros {
  const next = { ...f }
  if (ver) delete next.alegra
  else next.alegra = "active"
  return next
}

/** Estado que muestra «Datos de Alegra»: el mismo criterio que el aviso de «no publicado». */
export const estadoAlegraTexto = (motivos: readonly MotivoNoPublicado[]): "Activo" | "Inactivo" =>
  motivos.includes("inactivo_en_alegra") ? "Inactivo" : "Activo"
