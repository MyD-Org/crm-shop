/**
 * Respuestas grabadas de Jev (`jev-grabado.json`, `npm run banco:grabar`) y un
 * cliente falso que las devuelve: el test offline corre *Entender* con ellas,
 * sin red ni gasto. Módulo puro.
 */
import { pareceCodigo } from "../../busqueda-inteligente/gate";
import type { PreguntaChoice, Respuestas } from "../../busqueda-inteligente/jev";
import { normalizarConsulta } from "../../busqueda-inteligente/normalizar";

export interface JevGrabado {
  modelo: string;
  grabadoEl: string;
  /** Si el archivo se amplió después con `banco:grabar --solo-faltantes`: la fecha (el modelo es el mismo). */
  ampliadoEl?: string;
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

/**
 * Consultas del banco (normalizadas, sin repetir) que NO tienen respuesta
 * grabada: las que `banco:grabar --solo-faltantes` tiene que preguntarle a
 * Jev. Los códigos (nunca llegan a Jev) y lo que no se normaliza (datos
 * personales) no cuentan.
 */
export function faltantes(banco: readonly { q: string }[], g: JevGrabado): string[] {
  const salida = new Set<string>();
  for (const { q } of banco) {
    const norm = normalizarConsulta(q);
    if (!norm || pareceCodigo(q) || norm in g.respuestas) continue;
    salida.add(norm);
  }
  return [...salida];
}

/**
 * El grabado ampliado con respuestas nuevas, sin tocar las existentes (si una
 * consulta ya estaba, queda la grabación previa). Conserva modelo y fecha de
 * grabado; registra la fecha de la ampliación. No muta el original.
 */
export function mezclar(g: JevGrabado, nuevas: JevGrabado["respuestas"], hoy: string): JevGrabado {
  const agregadas = Object.fromEntries(Object.entries(nuevas).filter(([k]) => !(k in g.respuestas)));
  return { modelo: g.modelo, grabadoEl: g.grabadoEl, ampliadoEl: hoy, respuestas: { ...g.respuestas, ...agregadas } };
}
