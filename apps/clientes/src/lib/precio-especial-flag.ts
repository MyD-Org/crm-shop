/**
 * Flag del precio especial de la cuenta (#219): la lista de precios propia del cliente.
 *
 * Apagado (default): el precio depende SOLO del medio de pago elegido (ver `lista-medio.ts`); no se
 * aplica ni se muestra el precio especial (badge, tachado, "Precio exclusivo para su cuenta") y
 * `/api/precios-cuenta` responde `{ especial: false }`.
 * Prendido: se restaura el comportamiento previo (lista del cliente) y se IGNORA la lista del medio.
 *
 * Se lee sólo en el server, nunca dentro de `use cache`. Vive en Vercel Flags (key
 * `precio-especial-cuenta`, ver src/flags.ts): se cambia sin redeploy. Si no se puede evaluar,
 * se asume apagado.
 */
import { precioEspecialCuentaFlag } from "@/flags";

export async function precioEspecialCuenta(): Promise<boolean> {
  try {
    return (await precioEspecialCuentaFlag()) === true;
  } catch {
    return false;
  }
}
