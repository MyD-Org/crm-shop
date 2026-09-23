/**
 * Flag del envío a domicilio. Se lee sólo en el server: al checkout le llega
 * un booleano (`envioHabilitado`), nunca el flag.
 *
 * Apagado (default): el checkout sólo ofrece "Retiro en local / a coordinar",
 * `POST /api/pedidos` rechaza `entregaTipo: "envio"` y Mi cuenta no anuncia el
 * envío. Prendido: el envío propio de envio.ts (ciudades y mínimo) como antes.
 *
 * Vive en Vercel Flags (key `envio`, ver src/flags.ts): se cambia sin redeploy.
 */
import { envioFlag } from "@/flags";

export async function envioHabilitado(): Promise<boolean> {
  return envioFlag();
}
