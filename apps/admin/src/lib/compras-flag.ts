/**
 * Flags del módulo Compras (Vercel Flags, ver lib/flags.ts). Sólo se leen en el server: rutas,
 * páginas y menú. Falla cerrado: si Vercel Flags no responde, queda apagado.
 *
 *  - `compras-en-transito`: el módulo completo (menú, páginas, APIs). Apagado = 404 y sin menú.
 *  - `compras-recepcion`: Recibir / Cerrar con faltante / Editar. Sólo vale con el módulo prendido.
 */
import { comprasEnTransitoFlag, comprasRecepcionFlag } from "@/lib/flags"

export async function comprasHabilitado(): Promise<boolean> {
  try {
    return (await comprasEnTransitoFlag()) === true
  } catch {
    return false
  }
}

export async function comprasRecepcionHabilitada(): Promise<boolean> {
  try {
    if ((await comprasEnTransitoFlag()) !== true) return false
    return (await comprasRecepcionFlag()) === true
  } catch {
    return false
  }
}
