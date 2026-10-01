/**
 * Respuestas grabadas de Jev (`jev-grabado.json`, `npm run banco:grabar`) y un
 * cliente falso que las devuelve: el test offline corre *Entender* con ellas,
 * sin red ni gasto. Módulo puro.
 */
import type { PreguntaChoice, Respuestas } from "../../busqueda-inteligente/jev";

export interface JevGrabado {
  modelo: string;
  grabadoEl: string;
  /** Por consulta normalizada: la llamada principal y, si se hizo, la de subcategoría. */
  respuestas: Record<string, { principal: Respuestas; sub?: Respuestas }>;
}

/**
 * Cliente de Jev que responde con lo grabado: la llamada con la pregunta `sub`
 * devuelve la de subcategoría; cualquier otra, la principal (sólo las
 * preguntas que se hicieron). Una consulta sin grabar responde `null` (como
 * Jev caído).
 */
export function jevGrabado(g: JevGrabado) {
  return async (consulta: string, preguntas: Record<string, PreguntaChoice>): Promise<Respuestas | null> => {
    const r = g.respuestas[consulta];
    if (!r) return null;
    const fuente = "sub" in preguntas ? r.sub : r.principal;
    if (!fuente) return null;
    return Object.fromEntries(Object.entries(fuente).filter(([id]) => id in preguntas));
  };
}
