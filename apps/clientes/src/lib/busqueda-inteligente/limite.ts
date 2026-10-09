/**
 * Tope de llamadas a Jev (cuestan dinero): cada consulta distinta en `?q=`
 * que no está en la caché puede costar hasta 2 llamadas. Sin tope, un script
 * que recorra búsquedas al azar gasta sin límite.
 *
 * Por interpretación (no por llamada): ~20 por minuto por IP y un techo
 * global de 300 por minuto (rate limit compartido en Redis cuando hay
 * credenciales, si no por proceso: ver rate-limit.ts). Pasado el tope, Jev "no responde": la interpretación queda
 * en lo determinista y NO se guarda en la caché (se reintenta después).
 */
import { permitirAsync } from "../rate-limit";
import type { PreguntaChoice, Respuestas } from "./jev";

export const JEV_POR_IP_POR_MINUTO = 20;
export const JEV_GLOBAL_POR_MINUTO = 300;
const MINUTO = 60_000;

/** Cliente de Jev (fase 1 y búsqueda v2 tienen la misma forma). */
type ClienteJev = (consulta: string, preguntas: Record<string, PreguntaChoice>, timeoutMs: number) => Promise<Respuestas | null>;

/**
 * ¿Hay cupo para `prefijo` (por IP y global, mismos topes que Jev)? Consume uno de cada si lo hay.
 * Lo usa también la búsqueda v2 para las escrituras de planes en la base.
 */
export async function dentroDelTope(prefijo: string, ip: string, puede: typeof permitirAsync = permitirAsync): Promise<boolean> {
  return (await puede(`${prefijo}:${ip}`, JEV_POR_IP_POR_MINUTO, MINUTO)) && puede(`${prefijo}:global`, JEV_GLOBAL_POR_MINUTO, MINUTO);
}

/**
 * Envuelve el cliente de Jev con el tope. Se decide en la PRIMERA llamada de
 * la interpretación (una caché acertada no gasta cupo) y vale para las dos.
 */
export function jevConTope(jev: ClienteJev, ip: string, puede: typeof permitirAsync = permitirAsync): ClienteJev {
  let permitido: boolean | undefined;
  return async (consulta, preguntas, timeoutMs) => {
    permitido ??= await dentroDelTope("busqueda-ia-jev", ip, puede);
    if (!permitido) return null;
    return jev(consulta, preguntas, timeoutMs);
  };
}
