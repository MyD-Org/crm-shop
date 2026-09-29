import { PROVINCIAS, claveProvincia } from "@/lib/provincias"
import type { ReglaAplicada } from "@/lib/sucursales-zona"

// Texto legible (en usted) de la sucursal de un pedido y de la regla que la asignó. Puro: los
// nombres de sucursal llegan como datos (`slug -> nombre`); un slug que ya no existe se muestra
// tal cual. Pedidos anteriores a las sucursales (NULL) = "Sin sucursal".

export const SIN_SUCURSAL = "Sin sucursal"

export type NombresSucursal = Record<string, string>

const nombreDe = (slug: string, nombres: NombresSucursal) => nombres[slug] ?? slug

function nombreProvincia(clave: string | null): string | null {
  if (!clave) return null
  return PROVINCIAS.find((p) => claveProvincia(p) === clave) ?? null
}

/** "Iguazú, por zona Misiones" / "Mar del Plata, por retiro en local" / "Sin sucursal". */
export function reglaATexto(
  sucursal: string | null,
  regla: ReglaAplicada | null,
  nombres: NombresSucursal = {},
): string {
  if (!sucursal) return SIN_SUCURSAL
  const nombre = nombreDe(sucursal, nombres)
  // Con sucursal pero sin regla (pedido rellenado por la migración): no hay motivo que mostrar.
  if (!regla) return `${nombre}, pedido anterior a las zonas`
  switch (regla.motivo) {
    case "zona": {
      const provincia = nombreProvincia(regla.provincia)
      return provincia ? `${nombre}, por zona ${provincia}` : `${nombre}, por zona`
    }
    case "predeterminada": {
      const provincia = nombreProvincia(regla.provincia)
      return provincia
        ? `${nombre}, sucursal predeterminada (${provincia} no tiene zona)`
        : `${nombre}, sucursal predeterminada`
    }
    case "fallback_inactiva":
      return `${nombre}, por respaldo (la sucursal de la zona está inactiva)`
    case "retiro_local":
      return `${nombre}, por retiro en local`
    default:
      return nombre
  }
}
