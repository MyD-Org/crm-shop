import { PROVINCIAS, claveProvincia } from "@/lib/provincias"
import type { ZonaDto } from "@/lib/sucursales-repo"

// Lógica pura de la sección «Zonas y envíos» (Envíos): qué provincias atiende cada sucursal, a
// dónde envía y el resumen en lenguaje simple que se muestra al pie de cada tarjeta.

export type ZonaEditable = Pick<ZonaDto, "provinciaClave" | "provincia" | "sucursal" | "facturaSucursal">

/** Diferencia entre las zonas guardadas y las editadas: qué guardar (alta o cambio) y qué quitar. */
export function planZonas(originales: ZonaEditable[], editadas: ZonaEditable[]) {
  const antes = new Map(originales.map((z) => [z.provinciaClave, z]))
  const despues = new Set(editadas.map((z) => z.provinciaClave))
  const guardar = editadas.filter((z) => {
    const o = antes.get(z.provinciaClave)
    return !o || o.sucursal !== z.sucursal || (o.facturaSucursal ?? null) !== (z.facturaSucursal ?? null)
  })
  const quitar = originales.filter((z) => !despues.has(z.provinciaClave)).map((z) => z.provinciaClave)
  return { guardar, quitar }
}

/** Provincias que todavía no tiene ninguna sucursal asignada, en el orden de la lista fija. */
export function provinciasLibres(zonas: ZonaEditable[]): string[] {
  const usadas = new Set(zonas.map((z) => z.provinciaClave))
  return PROVINCIAS.filter((p) => !usadas.has(claveProvincia(p)))
}

/** Asigna una provincia a una sucursal. Si otra la tenía, pasa a esta (se conserva quién factura). */
export function asignarProvincia(zonas: ZonaEditable[], provincia: string, sucursal: string): ZonaEditable[] {
  const clave = claveProvincia(provincia)
  const previa = zonas.find((z) => z.provinciaClave === clave)
  const factura = previa?.facturaSucursal && previa.facturaSucursal !== sucursal ? previa.facturaSucursal : null
  return [...zonas.filter((z) => z.provinciaClave !== clave), { provinciaClave: clave, provincia, sucursal, facturaSucursal: factura }]
}

/** Entradas de «ciudades» que en realidad son nombres de provincia (error de carga frecuente). */
export function ciudadesQueSonProvincias(ciudades: string[]): string[] {
  const claves = new Set(PROVINCIAS.map(claveProvincia))
  return ciudades.filter((c) => claves.has(claveProvincia(c)))
}

/** "A", "A y B", "A, B y C". */
export function enumerar(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`
}

export interface DatosResumen {
  activa: boolean
  predeterminada: boolean
  provincias: string[]
  aceptaEnvio: boolean
  ciudades: string[]
}

/** Resumen en lenguaje simple de lo que hace una sucursal con la configuración actual. */
export function resumenSucursal(d: DatosResumen): string {
  if (!d.activa) return "Sucursal inactiva: no recibe pedidos. Sus provincias pasan a la sucursal que atiende las provincias sin asignar."

  const provincias = [...d.provincias].sort((a, b) => a.localeCompare(b))
  let atiende: string
  if (provincias.length > 0 && d.predeterminada) {
    atiende = `Atiende los pedidos de ${enumerar(provincias)} y de todas las provincias sin sucursal asignada.`
  } else if (provincias.length > 0) {
    atiende = `Atiende los pedidos de ${enumerar(provincias)}.`
  } else if (d.predeterminada) {
    atiende = "Atiende los pedidos de todas las provincias sin sucursal asignada."
  } else {
    return "No atiende ninguna provincia: solo recibe pedidos para retirar en este local."
  }

  let envio: string
  if (!d.aceptaEnvio) envio = "No envía a domicilio: esos clientes solo pueden retirar el pedido en un local."
  else if (d.ciudades.length === 0) envio = "Envía a domicilio a cualquier ciudad de esa zona."
  else envio = `Envía a domicilio solo a ${enumerar(d.ciudades)}. En el resto de la zona, el cliente debe retirar el pedido en un local.`

  return `${atiende} ${envio}`
}
