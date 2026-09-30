/**
 * Segundo escalón de la interpretación: Jev (Typesafe), un modelo de
 * clasificación barato y rápido (~430 ms, ~USD 0,00007 por búsqueda en el
 * spike del 2026-09-29). SOLO servidor: usa `JEV_API_KEY`.
 *
 * Reglas que salen del spike (spec catálogo asistido):
 * - Sólo preguntas `choice`, nunca `noul` ni `score` (positivos y negativos se
 *   solapan). Los atributos llevan siempre la opción `no_especifica`.
 * - Modelo pineado (`jev-1.13.0`), timeout de 2,5 s y SIN reintentos: si Jev
 *   no responde a tiempo, la búsqueda sigue con lo determinista.
 * - Sólo viaja la consulta y los nombres de categoría (datos públicos). Nunca
 *   se loguea la consulta: en los errores, sólo el tipo de error.
 *
 * Semáforo por elemento: confianza ≥ 0,9 → aplicar; 0,7–0,9 → sugerir;
 * menos → nada.
 */
import type { NodoArbol } from "./tipos";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODELO = "jev-1.13.0";
export const JEV_TIMEOUT_MS = 2500;

/** Confianza desde la que un elemento se aplica solo. */
export const UMBRAL_APLICAR = 0.9;
/** Confianza desde la que un elemento se sugiere (y desde la que se pregunta la subcategoría). */
export const UMBRAL_SUGERIR = 0.7;

export type Nivel = "aplicar" | "sugerir" | null;

/** Semáforo: qué hacer con un elemento según la confianza de Jev. */
export function nivelDe(confianza: number): Nivel {
  if (confianza >= UMBRAL_APLICAR) return "aplicar";
  if (confianza >= UMBRAL_SUGERIR) return "sugerir";
  return null;
}

export interface PreguntaChoice {
  type: "choice";
  question: string;
  /** Opción → descripción. */
  criteria: Record<string, string>;
}

export interface RespuestaChoice {
  choice: string;
  confidence: number;
}

export type Respuestas = Record<string, RespuestaChoice>;

export interface OpcionesJev {
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Contexto que viaja como `state`: la consulta, entre comillas y sin nada más. */
export function estadoJev(consulta: string): string {
  return `Un cliente escribió esto en el buscador de una tienda de electricidad e iluminación: "${consulta.replace(/"/g, "'")}"`;
}

/**
 * Una llamada a Jev. `null` si no hay key, se pasa del timeout, responde mal o
 * la respuesta no tiene la forma esperada. Sólo devuelve las respuestas cuya
 * opción existe en la pregunta y cuya confianza es un número entre 0 y 1.
 */
export async function consultarJev(
  consulta: string,
  preguntas: Record<string, PreguntaChoice>,
  opciones: OpcionesJev = {},
): Promise<Respuestas | null> {
  const apiKey = (opciones.apiKey ?? process.env.JEV_API_KEY)?.trim();
  if (!apiKey || Object.keys(preguntas).length === 0) return null;
  const hacerFetch = opciones.fetch ?? fetch;
  try {
    const res = await hacerFetch(JEV_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: JEV_MODELO, state: estadoJev(consulta), questions: preguntas }),
      signal: AbortSignal.timeout(opciones.timeoutMs ?? JEV_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[busqueda-ia] Jev respondió ${res.status}`);
      return null;
    }
    const cuerpo = (await res.json()) as { answers?: Record<string, unknown> };
    const respuestas: Respuestas = {};
    for (const [id, pregunta] of Object.entries(preguntas)) {
      const r = cuerpo.answers?.[id] as { type?: unknown; choice?: unknown; confidence?: unknown } | undefined;
      if (
        r?.type === "choice" &&
        typeof r.choice === "string" &&
        Object.hasOwn(pregunta.criteria, r.choice) &&
        typeof r.confidence === "number" &&
        r.confidence >= 0 &&
        r.confidence <= 1
      ) {
        respuestas[id] = { choice: r.choice, confidence: r.confidence };
      }
    }
    return respuestas;
  } catch (err) {
    console.error(`[busqueda-ia] falló Jev: ${err instanceof Error ? err.name : "desconocido"}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Preguntas del catálogo
// ---------------------------------------------------------------------------

const NO_ESPECIFICA = "no_especifica";

export const PREGUNTA_TONO: PreguntaChoice = {
  type: "choice",
  question: "¿Qué tono de luz pide el cliente de forma explícita?",
  criteria: {
    calido: "Luz cálida o amarilla (2700 K a 3000 K)",
    neutro: "Luz neutra (4000 K a 4500 K)",
    frio: "Luz fría, blanca o luz día (6000 K a 6500 K)",
    [NO_ESPECIFICA]: "La búsqueda no menciona el tono de la luz",
  },
};

export const PREGUNTA_AMBIENTE: PreguntaChoice = {
  type: "choice",
  question: "¿La búsqueda dice que es para usar en exterior o en interior?",
  criteria: {
    exterior: "Para exterior: patio, jardín, fachada, intemperie o lugares expuestos al agua",
    interior: "Para interior de una casa, oficina o local",
    [NO_ESPECIFICA]: "La búsqueda no dice dónde se va a usar",
  },
};

/** Opción de tono → atributo del diccionario. */
export const ATRIBUTO_DE_TONO: Record<string, string> = {
  calido: "tono-calido",
  neutro: "tono-neutro",
  frio: "tono-frio",
};

/** Opción de ambiente → atributo del diccionario (interior no tiene filtro). */
export const ATRIBUTO_DE_AMBIENTE: Record<string, string> = { exterior: "apto-exterior" };

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "categoria";

/**
 * Opciones de una pregunta de categoría: clave legible y única (el slug del
 * nombre, con sufijo si se repite) → nodo. La descripción de cada opción son
 * sus subcategorías activas, o su propio nombre si no tiene.
 */
export function opcionesDeCategorias(
  nodos: NodoArbol[],
  arbol: NodoArbol[],
): { criteria: Record<string, string>; porClave: Map<string, NodoArbol> } {
  const criteria: Record<string, string> = {};
  const porClave = new Map<string, NodoArbol>();
  const ordenados = [...nodos].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  for (const n of ordenados) {
    let clave = slug(n.nombre);
    for (let i = 2; porClave.has(clave); i++) clave = `${slug(n.nombre)}_${i}`;
    const hijas = hijasDe(arbol, n.id).map((h) => h.nombre);
    criteria[clave] = hijas.length ? `${n.nombre}: ${hijas.join(", ")}` : n.nombre;
    porClave.set(clave, n);
  }
  return { criteria, porClave };
}

/** Hijas activas directas de un nodo, en el orden del CRM. */
export function hijasDe(arbol: NodoArbol[], id: string | null): NodoArbol[] {
  return arbol
    .filter((n) => n.parentId === id)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
}
