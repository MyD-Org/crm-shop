// Pestañas de la página Pedidos (lógica pura, testeable sin React).

export type PestanaPedidos = "pedidos" | "carritos" | "intentos"

export const PESTANAS_PEDIDOS: readonly { value: PestanaPedidos; label: string }[] = [
  { value: "pedidos", label: "Pedidos" },
  { value: "carritos", label: "Carritos abandonados" },
  { value: "intentos", label: "Intentos de pago" },
]

/** Valor de `?tab=` → pestaña habilitada; cualquier otra cosa (ausente, inválida, deshabilitada) → Pedidos. */
export function pestanaValida(
  valor: string | null | undefined,
  habilitadas: readonly PestanaPedidos[] = PESTANAS_PEDIDOS.map((p) => p.value),
): PestanaPedidos {
  const encontrada = PESTANAS_PEDIDOS.find((p) => p.value === valor && habilitadas.includes(p.value))
  return encontrada ? encontrada.value : "pedidos"
}

/** La URL actual con `?tab=` puesto (Pedidos lo quita: es la pestaña por defecto). */
export function urlConPestana(href: string, pestana: PestanaPedidos): string {
  const url = new URL(href, "http://localhost")
  if (pestana === "pedidos") url.searchParams.delete("tab")
  else url.searchParams.set("tab", pestana)
  return `${url.pathname}${url.search}${url.hash}`
}
