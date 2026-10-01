// Textos de resumen de las reglas de una cuenta bancaria (puro, sin Next ni DB: lo usa el
// listado del admin). Formato determinista (no depende de Intl) para que servidor y navegador
// rendericen igual.

function formatear(n: number): string {
  const [entera, decimales] = n.toFixed(2).split(".")
  const miles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return decimales === "00" ? miles : `${miles},${decimales}`
}

export function resumenSucursales(c: { todasLasSucursales: boolean; sucursalSlugs: string[] }): string {
  return c.todasLasSucursales ? "Todas las sucursales" : `Sucursales: ${c.sucursalSlugs.join(", ")}`
}

export function resumenMonto(c: { montoMin: number | null; montoMax: number | null }): string {
  const min = c.montoMin !== null && c.montoMin > 0 ? c.montoMin : null
  if (min === null && c.montoMax === null) return "Cualquier monto"
  if (min === null) return `Monto: hasta ${formatear(c.montoMax as number)}`
  if (c.montoMax === null) return `Monto: desde ${formatear(min)}`
  return `Monto: de ${formatear(min)} a ${formatear(c.montoMax)}`
}
