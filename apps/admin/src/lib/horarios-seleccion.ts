// Qué sucursal edita Admin → Horarios (change `horarios-por-sucursal`). Puro, sin DB.
//
// - Sin sucursales activas → null: se edita el horario de la empresa (`tenants`), sin selector.
// - Con sucursales activas → la pedida por `?sucursal=` si es una de las activas; si no existe,
//   está dada de baja o viene repetida/mal formada → la predeterminada; si tampoco hay → la primera.

export interface SucursalElegible {
  slug: string
  predeterminada: boolean
}

export function resolverSucursalElegida(
  activas: SucursalElegible[],
  pedida: string | string[] | undefined,
): string | null {
  if (activas.length === 0) return null
  const slug = typeof pedida === "string" ? pedida : undefined
  const pedidaActiva = slug ? activas.find((s) => s.slug === slug) : undefined
  return (pedidaActiva ?? activas.find((s) => s.predeterminada) ?? activas[0]).slug
}
