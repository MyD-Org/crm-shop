/**
 * Flag `correo` (Vercel Flags, ver lib/flags.ts). Se lee solo en el server: rutas, páginas y el
 * webhook. Apagado (default): sin menú, páginas ni rutas de Correo (404) y el webhook de
 * recepción responde 200 sin procesar. Si Vercel Flags no responde, queda apagado.
 */
import { correoFlag } from "@/lib/flags"

export async function correoHabilitado(): Promise<boolean> {
  try {
    return (await correoFlag()) === true
  } catch {
    return false
  }
}
