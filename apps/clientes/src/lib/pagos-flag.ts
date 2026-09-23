/**
 * Flag de los medios de pago del checkout. Se lee sólo en el server (route
 * handlers y Server Components): al cliente le llega un booleano
 * (`pagosHabilitados`), nunca el env. Ningún client component importa este
 * archivo.
 *
 * Apagado (default): el checkout no muestra "Forma de pago", el único método
 * válido es "a_coordinar" y no se puede iniciar ningún cobro. Prendido ("1"):
 * el checkout se comporta exactamente como antes de este flag. No se borró
 * código de pagos: prender el flag alcanza para volver a cobrar.
 *
 * Vive en Vercel Flags (key `pagos`, ver src/flags.ts): se cambia sin redeploy.
 */
import { pagosFlag } from "@/flags";

export async function pagosHabilitados(): Promise<boolean> {
  return pagosFlag();
}
