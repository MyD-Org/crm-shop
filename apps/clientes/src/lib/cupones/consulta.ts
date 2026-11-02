/**
 * Consultar un cupón con el límite propio de consultas: 60 cada 10 minutos por cuenta y 300 por IP,
 * contado ANTES de leer la base y compartido por `/api/carrito/cotizar` y `POST /api/pedidos`. Holgado
 * para el carrito y el checkout (que recotizan con el mismo código); hace inviable recorrer los ~28
 * millones de códigos de un prefijo. Superado, el cupón sale como `no_disponible`. SOLO servidor.
 */
import { permitirAsync } from "../rate-limit";
import { mensajeCupon } from "./mensajes";
import { resolverCupon, type CuponResuelto, type QuienCupon } from "./repo";

export const MAX_CUPONES_POR_VENTANA = 60;
/** Por IP (invitados): una IP de operadora móvil (CGNAT) la comparten muchas personas. */
export const MAX_CUPONES_POR_IP = 300;
export const VENTANA_CUPONES_MS = 10 * 60_000;

/** `clave`: la cuenta (clerk o código de cliente) o `ip:<ip>` del visitante. null si no se ingresó código. */
export async function consultarCupon(raw: unknown, q: QuienCupon | null, clave: string): Promise<CuponResuelto | null> {
  if (raw == null || raw === "") return null;
  const max = clave.startsWith("ip:") ? MAX_CUPONES_POR_IP : MAX_CUPONES_POR_VENTANA;
  if (!(await permitirAsync(`cupon:${clave}`, max, VENTANA_CUPONES_MS))) {
    return { ok: false, error: { motivo: "no_disponible", mensaje: mensajeCupon("no_disponible") } };
  }
  return resolverCupon(raw, q);
}
