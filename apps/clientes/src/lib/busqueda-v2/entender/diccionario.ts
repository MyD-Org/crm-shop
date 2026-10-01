/**
 * Diccionario de la búsqueda v2: CANDIDATAS, no decisiones (spec
 * 2026-10-01). Módulo puro.
 *
 * En la fase 1 una palabra que coincidía con una categoría la aplicaba sin
 * preguntarle a nadie ("cámara para ver la casa desde el celular" → Cámaras,
 * nunca Cámara wifi). Acá el diccionario sólo propone:
 *
 * - categorías candidatas: las que tienen todas sus palabras en la consulta
 *   (o en sus expansiones) y las que tienen su sustantivo principal (la
 *   primera palabra significativa del nombre: "Extractores de aire" →
 *   extractor). Sirven para que una categoría de Jev pase a dura sólo con el
 *   acuerdo de las dos fuentes, y como blandas cuando no hay Jev;
 * - atributos explícitos: un sinónimo del diccionario de atributos escrito tal
 *   cual ("cálido", "e27", "ip65"). Son candidatos FUERTES;
 * - atributos de contexto: el lugar sugiere un atributo sin pedirlo ("patio" →
 *   apto exterior). Siempre blandos.
 */
import { raizPlural } from "../../catalogo-busqueda";
import { deterministico, palabrasCategoria, tokensDe } from "../../busqueda-inteligente/deterministico";
import type { NodoArbol } from "../../busqueda-inteligente/tipos";
import { expansiones } from "./sinonimos";
import { CONTEXTO } from "./terminos";

/** Lugares que sugieren "apto exterior" sin pedirlo. */
const LUGARES_EXTERIOR = new Set(["patio", "jardin", "fachada", "vereda", "pileta", "piscina", "parque", "quincho", "cancha"]);

/** Tope de categorías candidatas. */
const MAX_CANDIDATAS = 5;

export interface CandidatosDiccionario {
  categorias: string[];
  atributosExplicitos: string[];
  atributosContexto: string[];
  /** Tokens que absorbió un atributo explícito. */
  absorbidos: Set<string>;
}

/** Categorías activas (alcanzables desde una raíz activa) en orden de lectura. */
function vivas(arbol: NodoArbol[]): NodoArbol[] {
  const salida: NodoArbol[] = [];
  const vistos = new Set<string>();
  const recorrer = (parentId: string | null) => {
    const hijas = arbol
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
    for (const n of hijas) {
      if (vistos.has(n.id)) continue;
      vistos.add(n.id);
      salida.push(n);
      recorrer(n.id);
    }
  };
  recorrer(null);
  return salida;
}

export function candidatos(consultaNorm: string, arbol: NodoArbol[]): CandidatosDiccionario {
  const det = deterministico(consultaNorm, arbol);
  const tokens = tokensDe(consultaNorm).filter((t) => !det.absorbidos.has(t)).map(raizPlural);
  const conExpansiones = new Set([...tokens, ...expansiones(tokens, consultaNorm).map(raizPlural)]);
  // El sustantivo principal no cuenta si es contexto: "luz" no hace candidata a "Luces de emergencia".
  const sustantivos = new Set([...conExpansiones].filter((t) => !CONTEXTO.has(t)));
  const porSustantivo = vivas(arbol)
    .filter((n) => {
      const palabras = palabrasCategoria(n.nombre);
      return palabras.length > 0 && (sustantivos.has(palabras[0]) || palabras.every((p) => conExpansiones.has(p)));
    })
    .map((n) => n.nombre);
  const categorias = [...new Set([...det.categorias, ...porSustantivo])].slice(0, MAX_CANDIDATAS);
  const contexto = tokens.some((t) => LUGARES_EXTERIOR.has(t)) && !det.atributos.includes("apto-exterior");
  return {
    categorias,
    atributosExplicitos: det.atributos,
    atributosContexto: contexto ? ["apto-exterior"] : [],
    absorbidos: det.absorbidos,
  };
}
