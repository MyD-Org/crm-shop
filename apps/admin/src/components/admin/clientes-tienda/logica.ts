// Lógica PURA de "Clientes de la tienda" (sin React, sin fetch, sin next): query de la lista,
// opciones de los Select, etiquetas y tonos. Vive aparte del componente porque esta app no
// tiene jsdom: lo que se puede equivocar se prueba acá. Los tipos se importan con `import type`
// para no arrastrar el repo (y getDb) al bundle del cliente.

import type { BadgeTone } from "@myd-org/ui"
import type {
  AccesoFacturacion,
  ClienteTiendaDto,
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

// ───────────────────────── Acciones de admin (R4a) ─────────────────────────

export interface AccionesCliente {
  vincular: boolean
  desvincular: boolean
  darAcceso: boolean
  quitarAcceso: boolean
}

/**
 * Qué botones ofrece el detalle. Sólo esconde: la autoridad es `requireAdminPlus` en la API.
 *  - Vincular: sin vínculo activo (incluye sin coincidencia, ambiguo y revocado).
 *  - Dar acceso: vinculado a un contacto ACTIVO de contado sin excepción vigente. A un cuenta
 *    corriente no se le ofrece (ya tiene acceso); con el contacto inactivo o fuera del espejo
 *    tampoco (la API lo rechazaría).
 *  - Quitar acceso: hay excepción vigente, aunque el contacto esté inactivo.
 */
export function accionesDisponibles(c: ClienteTiendaDto, puedeGestionar: boolean): AccionesCliente {
  const ninguna = { vincular: false, desvincular: false, darAcceso: false, quitarAcceso: false }
  if (!puedeGestionar) return ninguna
  if (c.vinculo.estado !== "vinculado" || !c.vinculo.alegraContactId) return { ...ninguna, vincular: true }
  return {
    ...ninguna,
    desvincular: true,
    darAcceso: !c.excepcionVigente && c.tipoCuenta === "contado",
    quitarAcceso: c.excepcionVigente,
  }
}

export const textoConfirmarVincular = (razonSocial: string): string =>
  `Al vincular esta cuenta a ${razonSocial}, el usuario verá los precios y el historial de pedidos de ese cliente. ¿Desea continuar?`

export const textoConfirmarDesvincular = (razonSocial: string | null): string =>
  `¿Desea desvincular esta cuenta de ${razonSocial ?? "este cliente"}? El usuario dejará de ver sus precios, pedidos y Facturación en la próxima navegación.`

export const textoConfirmarDarAcceso = (razonSocial: string | null): string =>
  `Todos los usuarios vinculados a ${razonSocial ?? "este cliente"} verán Facturación en Mi cuenta. ¿Desea continuar?`

export const textoConfirmarQuitarAcceso = (razonSocial: string | null): string =>
  `¿Desea quitar el acceso a Facturación a ${razonSocial ?? "este cliente"}? Sus usuarios dejarán de verla en la próxima navegación.`

/** El {error} redactado de un 4xx; para un 5xx, la red caída o un cuerpo raro, el genérico. */
export function mensajeDeError(status: number | null, body: unknown, generico: string): string {
  if (status === null || status >= 500) return generico
  const error = (body as { error?: unknown } | null)?.error
  return typeof error === "string" && error.trim() !== "" ? error : generico
}
