/**
 * Flag del tracking. Se lee sólo en el server: al layout le llega la config
 * pública de los proveedores (o nada), nunca el flag.
 *
 * Apagado (default): no se carga ningún script de analítica ni píxel, y los
 * `track()` del carrito, la ficha y el checkout quedan en una cola que nadie
 * envía. Prendido: Vercel Web Analytics y Speed Insights siempre, y Meta
 * Pixel, GA4 y PostHog los que tengan su variable (ver tracking/config.ts).
 *
 * Existe para no medir el tráfico del equipo mientras la tienda está detrás de
 * la cortina: se prende el día de la apertura. Vive en Vercel Flags (key
 * `tracking`, ver src/flags.ts): se cambia sin redeploy.
 */
import { trackingFlag } from "@/flags";
import { configTracking, type ConfigTracking } from "./tracking/config";

export async function trackingActivo(): Promise<ConfigTracking | null> {
  if (!(await trackingFlag())) return null;
  return configTracking();
}
