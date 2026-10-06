/**
 * Flag `cuotas-cobro` (change listas-precio-online, rebanada D). Se lee sólo en el server (route
 * handlers y Server Components): al cliente llegan las opciones o nada, nunca el flag.
 *
 * Apagado (default): no hay cuotas en la tienda. No se exhiben ("N cuotas sin interés" promete un
 * cobro), el checkout no ofrece el selector, el pedido no congela cuotas y el cobro con Mercado
 * Pago queda como estaba. Los pedidos que ya congelaron cuotas conservan su validación.
 *
 * Vive en Vercel Flags (key `cuotas-cobro`, ver src/flags.ts): se cambia sin redeploy. Se prende
 * sólo con el gate cumplido: prueba en el sandbox de Mercado Pago, cuotas sin interés activadas en
 * su panel y validación del contador/abogado.
 */
import { cuotasCobroFlag } from "@/flags";

export async function cuotasHabilitadas(): Promise<boolean> {
  return cuotasCobroFlag();
}
