/**
 * Flag del cambio cuotas-configurables. Se lee sólo en el server (route
 * handlers y Server Components): al cliente llega la oferta o null, nunca el env.
 *
 * Apagado (default): no se muestran cuotas ni barra, el Brick no recibe máximo y
 * la ruta de pago vuelve al clamp 1..24. Precio final con IVA y neto NO dependen
 * de este flag. Cron, ping y congelado del plan en el pedido siguen corriendo.
 *
 * Vive en Vercel Flags (key `cuotas`, ver src/flags.ts): se cambia sin redeploy.
 */
import { cuotasFlag } from "@/flags";

export async function cuotasHabilitadas(): Promise<boolean> {
  return cuotasFlag();
}
