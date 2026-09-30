/**
 * Tope de llamadas a Jev (cuestan dinero): cada consulta distinta en `?q=`
 * que no está en la caché puede costar hasta 2 llamadas. Sin tope, un script
 * que recorra búsquedas al azar gasta sin límite.
 *
 * Por interpretación (no por llamada): ~20 por minuto por IP y un techo
 * global por proceso de 300 por minuto (rate limit en memoria, ver
 * rate-limit.ts). Pasado el tope, Jev "no responde": la interpretación queda
 * en lo determinista y NO se guarda en la caché (se reintenta después).
 */
import { permitir } from "../rate-limit";
import type { Dependencias } from "./interpretar";

export const JEV_POR_IP_POR_MINUTO = 20;
export const JEV_GLOBAL_POR_MINUTO = 300;
const MINUTO = 60_000;

type ClienteJev = NonNullable<Dependencias["jev"]>;

/**
 * Envuelve el cliente de Jev con el tope. Se decide en la PRIMERA llamada de
 * la interpretación (una caché acertada no gasta cupo) y vale para las dos.
 */
export function jevConTope(jev: ClienteJev, ip: string, puede: typeof permitir = permitir): ClienteJev {
  let permitido: boolean | undefined;
  return async (consulta, preguntas, timeoutMs) => {
    permitido ??=
      puede(`busqueda-ia-jev:${ip}`, JEV_POR_IP_POR_MINUTO, MINUTO) &&
      puede("busqueda-ia-jev:global", JEV_GLOBAL_POR_MINUTO, MINUTO);
    if (!permitido) return null;
    return jev(consulta, preguntas, timeoutMs);
  };
}
