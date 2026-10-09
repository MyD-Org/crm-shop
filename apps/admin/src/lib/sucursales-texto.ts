import { PROVINCIAS, claveProvincia } from "@/lib/provincias"
import type { ReglaAplicada } from "@/lib/sucursales-zona"

// Texto legible (en usted) de la sucursal de un pedido y de la regla que la asignó. Puro: los
// nombres de sucursal llegan como datos (`slug -> nombre`); un slug que ya no existe se muestra
// tal cual. Pedidos anteriores a las sucursales (NULL) = "Sin sucursal".

export const SIN_SUCURSAL = "Sin sucursal"

// Leyendas de la pestaña Sucursales: la regla que decide la cuenta de Alegra que factura decide
// también con qué cuenta de Mercado Pago y de Payway cobra la tienda (change
// `cuentas-procesador-por-sucursal`). Se agregan al copy existente, que no se reescribe.
export const LEYENDA_COBRO_ZONAS =
  " La misma regla decide con qué cuenta de Mercado Pago y de Payway cobra la tienda: la del CUIT de la sucursal que factura."
export const HINT_SUCURSAL_QUE_FACTURA =
  "Solo si factura una cuenta distinta de la que despacha. Esa misma cuenta es la que cobra en Mercado Pago y Payway."
export const DESCRIPCION_CUENTA_ALEGRA =
  "La cuenta define de dónde se toma el stock de la sucursal y por cuál se factura. También decide con qué cuenta de Mercado Pago y de Payway se cobran los pedidos que esta sucursal factura. El token se guarda en el servidor y no se vuelve a mostrar."

export type NombresSucursal = Record<string, string>

const nombreDe = (slug: string, nombres: NombresSucursal) => nombres[slug] ?? slug

export function nombreProvincia(clave: string | null): string | null {
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

/**
 * Enlace `https://wa.me/<solo dígitos>` para el WhatsApp de una sucursal. El número se guarda como
 * lo tipeó el operador ("+54 9 ..."); wa.me pide solo dígitos. Devuelve null si no hay dígitos
 * suficientes para que sea un número.
 */
export function whatsappLink(numero: string | null | undefined): string | null {
  const digitos = (numero ?? "").replace(/\D/g, "")
  return digitos.length >= 6 ? `https://wa.me/${digitos}` : null
}
