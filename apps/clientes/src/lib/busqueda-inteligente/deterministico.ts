/**
 * Primer escalón de la interpretación, sin costo: el diccionario de atributos
 * y los nombres de las categorías del tenant. Lo que encuentra se APLICA.
 * Módulo puro.
 *
 * - Atributos: un sinónimo del diccionario escrito como palabra o frase
 *   completa ("calida", "luz de dia", "e27", "ip65").
 * - Categorías: las palabras significativas del nombre de una categoría, en
 *   singular, aparecen en la consulta ("reflectores" → "Reflectores", "tira
 *   para cocina" → "Tiras LED"). Se descartan "led", "de", "y"…: casi todo el
 *   catálogo es LED y exigirlo dejaría afuera a quien no lo escribe.
 */
import { ATRIBUTOS } from "../catalogo-atributos";
import { raizPlural } from "../catalogo-busqueda";
import type { NodoArbol } from "./tipos";

/** Palabras del nombre de una categoría que no la identifican. */
const PALABRAS_VACIAS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "o", "para", "con", "a", "en", "led", "leds"]);

/** Tope de categorías que se aplican: más ya no es "entender" la búsqueda. */
const MAX_CATEGORIAS = 2;

/** Puntuación de los bordes de un término (mismo criterio que catalogo-busqueda). */
const BORDES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Tokens de una consulta ya normalizada, sin puntuación de borde. */
export function tokensDe(consultaNorm: string): string[] {
  return consultaNorm
    .split(/\s+/)
    .map((t) => t.replace(BORDES, ""))
    .filter(Boolean);
}

const normalizar = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Palabras significativas del nombre de una categoría, en singular. */
function palabrasCategoria(nombre: string): string[] {
  return tokensDe(normalizar(nombre))
    .filter((p) => !PALABRAS_VACIAS.has(p))
    .map(raizPlural);
}

/** Nodos alcanzables desde una raíz activa (una inactiva corta su rama, como en el menú). */
function nodosVivos(arbol: NodoArbol[]): Map<string, NodoArbol & { nivel: number }> {
  const vivos = new Map<string, NodoArbol & { nivel: number }>();
  const recorrer = (parentId: string | null, nivel: number) => {
    for (const n of arbol.filter((x) => x.parentId === parentId)) {
      if (vivos.has(n.id)) continue;
      vivos.set(n.id, { ...n, nivel });
      recorrer(n.id, nivel + 1);
    }
  };
  recorrer(null, 1);
  return vivos;
}

export interface ResultadoDeterministico {
  categorias: string[];
  atributos: string[];
  /** Tokens de la consulta que absorbió un atributo (no quedan como texto residual). */
  absorbidos: Set<string>;
}

/** Atributos cuyos sinónimos aparecen como palabra o frase completa. */
function atributosDe(tokens: string[]): { atributos: string[]; absorbidos: Set<string> } {
  const texto = ` ${tokens.join(" ")} `;
  const atributos: string[] = [];
  const absorbidos = new Set<string>();
  for (const a of ATRIBUTOS) {
    const presentes = a.sinonimos.filter((s) => texto.includes(` ${s} `));
    if (presentes.length === 0) continue;
    atributos.push(a.id);
    // "luz de dia" absorbe "luz", "de" y "dia"; "calido 3000k", las dos.
    for (const t of presentes.flatMap((s) => s.split(" "))) absorbidos.add(t);
  }
  return { atributos, absorbidos };
}

/**
 * Categorías cuyas palabras significativas están todas en la consulta. Si
 * matchean una categoría y alguna de sus madres, queda la más específica. Con
 * empate de palabras, gana la de más palabras (más específica por nombre).
 */
function categoriasDe(tokens: string[], arbol: NodoArbol[]): string[] {
  const enConsulta = new Set(tokens.map(raizPlural));
  const vivos = nodosVivos(arbol);
  const candidatas = [...vivos.values()]
    .map((n) => ({ nodo: n, palabras: palabrasCategoria(n.nombre) }))
    .filter((c) => c.palabras.length > 0 && c.palabras.every((p) => enConsulta.has(p)));
  const esAncestro = (a: string, de: string) => {
    for (let n = vivos.get(de); n?.parentId; n = vivos.get(n.parentId)) {
      if (n.parentId === a) return true;
    }
    return false;
  };
  return candidatas
    .filter((c) => !candidatas.some((o) => o !== c && esAncestro(c.nodo.id, o.nodo.id)))
    .sort((a, b) => b.palabras.length - a.palabras.length || b.nodo.nivel - a.nodo.nivel || a.nodo.orden - b.nodo.orden)
    .map((c) => c.nodo.nombre)
    .filter((nombre, i, todos) => todos.indexOf(nombre) === i)
    .slice(0, MAX_CATEGORIAS);
}

/** Interpretación determinista de una consulta YA normalizada (ver `normalizarConsulta`). */
export function deterministico(consultaNorm: string, arbol: NodoArbol[]): ResultadoDeterministico {
  const tokens = tokensDe(consultaNorm);
  const { atributos, absorbidos } = atributosDe(tokens);
  // Un token que absorbió un atributo no cuenta para la categoría ("exterior"
  // no es la categoría "Iluminación exterior" por sí solo… salvo que el
  // nombre tenga otra palabra que sí esté).
  const restantes = tokens.filter((t) => !absorbidos.has(t));
  return { categorias: categoriasDe(restantes, arbol), atributos, absorbidos };
}

/**
 * Texto residual al aplicar una interpretación: los tokens con dígitos que
 * ningún atributo absorbió ("reflector 50w calido" → "50w"). `undefined` si
 * no queda ninguno: la búsqueda se quita y mandan los filtros.
 */
export function textoResidual(consultaNorm: string, absorbidos: ReadonlySet<string>): string | undefined {
  const quedan = tokensDe(consultaNorm).filter((t) => /\d/.test(t) && !absorbidos.has(t));
  return quedan.length ? quedan.join(" ") : undefined;
}
