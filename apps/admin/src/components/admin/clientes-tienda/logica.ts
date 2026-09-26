// Lógica PURA de "Clientes de la tienda" (sin React, sin fetch, sin next): query de la lista,
// opciones de los Select, etiquetas y tonos. Vive aparte del componente porque esta app no
// tiene jsdom: lo que se puede equivocar se prueba acá. Los tipos se importan con `import type`
// para no arrastrar el repo (y getDb) al bundle del cliente.

import type { BadgeTone } from "@myd-org/ui"
import type {
  AccesoFacturacion,
  EstadoVinculo,
  FiltroAcceso,
  FiltroPedidos,
  FiltroVinculo,
} from "@/lib/clientes-tienda-repo"

export interface FiltrosLista {
  q: string
  vinculo: FiltroVinculo
  acceso: FiltroAcceso
  pedidos: FiltroPedidos
}

export const FILTROS_INICIALES: FiltrosLista = { q: "", vinculo: "todos", acceso: "todos", pedidos: "todos" }

export interface OpcionSelect<T extends string = string> {
  value: T
  label: string
}

// "todos" y no "": el Select del design system no admite un value vacío.
export const OPCIONES_VINCULO: OpcionSelect<FiltroVinculo>[] = [
  { value: "todos", label: "Todos los vínculos" },
  { value: "vinculados", label: "Vinculados" },
  { value: "sin_vincular", label: "Sin vincular" },
]

export const OPCIONES_ACCESO: OpcionSelect<FiltroAcceso>[] = [
  { value: "todos", label: "Con y sin Facturación" },
  { value: "con", label: "Con acceso a Facturación" },
  { value: "sin", label: "Sin acceso a Facturación" },
]

export const OPCIONES_PEDIDOS: OpcionSelect<FiltroPedidos>[] = [
  { value: "todos", label: "Con y sin pedidos" },
  { value: "con", label: "Con pedidos" },
]

/** Valor de un Select validado contra sus opciones; `undefined` si no es una de ellas. */
export function opcionValida<T extends string>(opciones: OpcionSelect<T>[], valor: string): T | undefined {
  return opciones.find((o) => o.value === valor)?.value
}

/** Query string de `GET /api/admin/clientes-tienda`. Los filtros viajan explícitos. */
export function queryDeLista(input: FiltrosLista & { start: number; limit: number }): string {
  const params = new URLSearchParams()
  const q = input.q.trim()
  if (q) params.set("q", q)
  params.set("vinculo", input.vinculo)
  params.set("acceso", input.acceso)
  params.set("pedidos", input.pedidos)
  params.set("start", String(Math.max(0, Math.trunc(input.start))))
  params.set("limit", String(input.limit))
  return params.toString()
}

export function hayFiltros(f: FiltrosLista): boolean {
  return f.q.trim() !== "" || f.vinculo !== "todos" || f.acceso !== "todos" || f.pedidos !== "todos"
}

export function mensajeVacio(conFiltros: boolean): string {
  return conFiltros
    ? "No hay clientes que coincidan con su búsqueda."
    : "Todavía no hay clientes registrados en la tienda."
}

const VINCULO: Record<EstadoVinculo, { label: string; tono: BadgeTone }> = {
  sin_vincular: { label: "Sin vincular", tono: "neutral" },
  sin_coincidencia: { label: "Sin coincidencia", tono: "neutral" },
  ambiguo: { label: "Ambiguo", tono: "warning" },
  vinculado: { label: "Vinculado", tono: "success" },
  revocado: { label: "Revocado", tono: "danger" },
}

export const etiquetaVinculo = (e: EstadoVinculo): string => VINCULO[e].label
export const tonoVinculo = (e: EstadoVinculo): BadgeTone => VINCULO[e].tono

const ACCESO: Record<AccesoFacturacion, { label: string; tono: BadgeTone }> = {
  corriente: { label: "Por cuenta corriente", tono: "success" },
  excepcion: { label: "Por excepción", tono: "info" },
  no: { label: "No", tono: "neutral" },
}

export const etiquetaAcceso = (a: AccesoFacturacion): string => ACCESO[a].label
export const tonoAcceso = (a: AccesoFacturacion): BadgeTone => ACCESO[a].tono

const METODO: Record<string, string> = {
  email_verificado: "Email verificado",
  otp_email: "Código por email",
  cookie_crm: "Portal de clientes",
  operador: "Operador",
}

/** Cómo se probó el vínculo. Un método que el CRM no conoce se muestra crudo. */
export function etiquetaMetodo(metodo: string | null): string | null {
  if (!metodo) return null
  return Object.hasOwn(METODO, metodo) ? METODO[metodo] : metodo
}

export function etiquetaTipoCuenta(tipo: "corriente" | "contado" | null): string {
  if (tipo === "corriente") return "Cuenta corriente"
  if (tipo === "contado") return "Contado"
  return "—"
}
