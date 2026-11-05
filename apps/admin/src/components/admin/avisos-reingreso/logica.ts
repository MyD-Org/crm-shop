// Lógica pura de la pestaña "Avisos de stock" de Pedidos (sin React ni fetch).

export const FILTRO_AVISOS_TODOS = "todos"

export const VACIO = "No hay avisos de stock pendientes para mostrar"
export const SIN_INTERESADOS = "Nadie espera este producto."

export const OPCIONES_FILTRO = [
  { value: FILTRO_AVISOS_TODOS, label: "Todos los productos" },
  { value: "quieren_encargar", label: "Con personas que lo encargarían" },
]

export function queryAvisos(input: { filtro?: string; start: number; limit: number }): string {
  const params = new URLSearchParams()
  if (input.filtro && input.filtro !== FILTRO_AVISOS_TODOS) params.set("filtro", input.filtro)
  params.set("start", String(Math.max(0, Math.trunc(input.start))))
  params.set("limit", String(input.limit))
  return params.toString()
}

export const queryInteresados = (alegraId: string): string => new URLSearchParams({ producto: alegraId }).toString()

/** "1 persona" / "3 personas". */
export const textoPersonas = (n: number): string => `${n} ${n === 1 ? "persona" : "personas"}`

/** Enlace de WhatsApp (wa.me) a partir de un teléfono libre; null si no tiene dígitos. */
export function enlaceWhatsapp(tel: string): string | null {
  const digitos = tel.replace(/\D/g, "")
  return digitos ? `https://wa.me/${digitos}` : null
}
