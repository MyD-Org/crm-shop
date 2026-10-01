/**
 * Preguntas a Jev de la búsqueda v2 (spec 2026-10-01, "Entender"). Módulo
 * puro: el cliente HTTP es el de la fase 1 (`consultarJev`, modelo pineado,
 * sin reintentos, nunca loguea la consulta).
 *
 * Una sola llamada con cuatro preguntas `choice` (intención, raíz, tono,
 * ambiente) y, sólo si la raíz salió con confianza ≥ 0,7 y queda presupuesto,
 * una segunda con la subcategoría. Reglas del spike: sólo `choice`, y los
 * atributos con `no_especifica`.
 */
import { PREGUNTA_AMBIENTE, PREGUNTA_TONO, hijasDe, opcionesDeCategorias, type PreguntaChoice } from "../../busqueda-inteligente/jev";
import type { NodoArbol } from "../../busqueda-inteligente/tipos";

/** Opción de la pregunta de intención → `Intencion` del plan. */
export const INTENCION_DE_OPCION = {
  codigo_o_modelo: "codigo",
  producto: "producto",
  necesidad: "necesidad",
  pregunta: "pregunta",
} as const;

export const PREGUNTA_INTENCION: PreguntaChoice = {
  type: "choice",
  question: "¿Qué está haciendo el cliente con lo que escribió en el buscador?",
  criteria: {
    codigo_o_modelo: "Escribe un código, un modelo o un número de artículo",
    producto: "Nombra un producto o un tipo de producto concreto, con o sin medidas o características",
    necesidad: "Describe un uso, un problema o un lugar sin nombrar exactamente el producto",
    pregunta: "Hace una pregunta o pide un consejo (cómo, cuánto, cuál conviene, si sirve)",
  },
};

export const PREGUNTA_RAIZ = "¿A qué categoría de la tienda corresponde lo que busca el cliente?";
export const PREGUNTA_SUB = "¿A qué subcategoría corresponde lo que busca el cliente?";

/** Confianza de la raíz desde la que se pregunta la subcategoría. */
export const UMBRAL_SUB = 0.7;

/** Raíces activas como opciones (vacío si el tenant tiene una sola o ninguna). */
export function opcionesRaiz(arbol: NodoArbol[]) {
  const raices = hijasDe(arbol, null);
  return raices.length > 1 ? opcionesDeCategorias(raices, arbol) : null;
}

/** Preguntas de la primera llamada. */
export function preguntasPrincipales(arbol: NodoArbol[]): Record<string, PreguntaChoice> {
  const raiz = opcionesRaiz(arbol);
  return {
    intencion: PREGUNTA_INTENCION,
    tono: PREGUNTA_TONO,
    ambiente: PREGUNTA_AMBIENTE,
    ...(raiz ? { raiz: { type: "choice", question: PREGUNTA_RAIZ, criteria: raiz.criteria } } : {}),
  };
}

/** Opciones y pregunta de la subcategoría de una raíz, o `null` si tiene menos de dos hijas. */
export function preguntaSub(arbol: NodoArbol[], raiz: NodoArbol) {
  const hijas = hijasDe(arbol, raiz.id);
  if (hijas.length < 2) return null;
  const opciones = opcionesDeCategorias(hijas, arbol);
  const pregunta: PreguntaChoice = { type: "choice", question: PREGUNTA_SUB, criteria: opciones.criteria };
  return { opciones, preguntas: { sub: pregunta } };
}
