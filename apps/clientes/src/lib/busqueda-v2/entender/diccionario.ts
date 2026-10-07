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
 *   extractor; uno ambiguo, como "interruptor", sólo si está escrito). Sirven para que una categoría de Jev pase a dura sólo con el
 *   acuerdo de las dos fuentes, y como blandas cuando no hay Jev;
 * - atributos explícitos: un sinónimo del diccionario de atributos escrito tal
 *   cual ("cálido", "e27", "ip65"). Son candidatos FUERTES;
 * - atributos de contexto: el lugar sugiere un atributo sin pedirlo ("patio" →
 *   apto exterior, "baño" → apto humedad). Siempre blandos.
 */
import { raizPlural } from "../../catalogo-busqueda";
import { deterministico, palabrasCategoria, tokensDe } from "../../busqueda-inteligente/deterministico";
import type { NodoArbol } from "../../busqueda-inteligente/tipos";
import { PESO_EXPANSION, expansiones } from "./sinonimos";
import { CONTEXTO, esLugar, terminosDe } from "./terminos";

/** Lugares que sugieren "apto exterior" sin pedirlo. */
const LUGARES_EXTERIOR = new Set([
  "patio", "jardin", "fachada", "vereda", "pileta", "piscina", "parque", "quincho", "cancha", "terraza", "balcon", "galeria",
]);

/** Lugares con humedad que sugieren "apto humedad" (IP44 o más) sin pedirlo: no hace falta intemperie, sí salpicaduras. */
const LUGARES_HUMEDAD = new Set(["bano", "ducha", "lavadero"]);

/**
 * Sustantivos que nombran productos distintos según el rubro: "interruptor" (de luz o
 * termomagnético), "llave" (de luz, térmica o de tubo). Como sinónimo de otra palabra no proponen
 * la categoría que empieza con ellos; escritos tal cual, sí.
 */
const AMBIGUOS = new Set(["interruptor", "llave"]);

/**
 * Palabras que piden luz en general, sin nombrar el artefacto ("luz para el patio", "iluminar el jardín"). La
 * categoría que se llama como la luz (la raíz de iluminación) es la candidata cuando, además, hay un lugar y
 * ninguna palabra de producto: quien pide "luz para el patio" busca luminarias, no cámaras ni cajas estancas
 * que comparten el "exterior".
 */
const PIDE_LUZ = new Set(["luz", "iluminacion", "iluminar", "ilumine", "alumbrar", "alumbre", "alumbrado"]);

/** La categoría de la luz en general: la que se llama como la raíz de iluminación. */
const CATEGORIA_DE_LUZ = "iluminacion";

/** Tope de categorías candidatas. */
const MAX_CANDIDATAS = 5;

export interface CandidatosDiccionario {
  categorias: string[];
  /**
   * "luz" + lugar y nada más ("luz para el patio"): la categoría de la luz y, en un lugar de intemperie, la
   * luminaria exterior. Aparte de `categorias` porque NO es evidencia para que una categoría pase a dura con
   * Jev: sólo suma de blanda cuando no hay Jev (`combinar`).
   */
  categoriasDeLuz?: string[];
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
  // Un sustantivo AMBIGUO cuenta sólo si se escribió: "tecla" se expande a "interruptor" para
  // encontrar productos, pero eso no hace candidata a "Interruptores termomagnéticos" (otro producto).
  const sustantivos = new Set(
    [...conExpansiones].filter((t) => !CONTEXTO.has(t) && (!AMBIGUOS.has(t) || tokens.includes(t))),
  );
  // "luz" + lugar y ninguna palabra de producto ni expansión ("luz para el patio"): la candidata es la categoría
  // de la luz. Con una palabra que nombra otra cosa ("llave de luz", "luz que se prenda sola" → sensor) no aplica.
  const terminos = terminosDe(consultaNorm, det.absorbidos);
  const soloLuzYLugar =
    tokens.some((t) => PIDE_LUZ.has(t)) && tokens.some((t) => esLugar(t)) && !terminos.some((t) => t.peso >= PESO_EXPANSION);
  // Y si el lugar es de intemperie, también la luminaria que se llama "exterior" (la luz de un patio no es la de un pasillo).
  const alAire = soloLuzYLugar && tokens.some((t) => LUGARES_EXTERIOR.has(t));
  const categoriasDeLuz = soloLuzYLugar
    ? vivas(arbol)
        .filter((n) => {
          const palabras = palabrasCategoria(n.nombre);
          return palabras[0] === CATEGORIA_DE_LUZ || (alAire && palabras.includes("exterior"));
        })
        .map((n) => n.nombre)
    : [];
  const porSustantivo = vivas(arbol)
    .filter((n) => {
      const palabras = palabrasCategoria(n.nombre);
      return palabras.length > 0 && (sustantivos.has(palabras[0]) || palabras.every((p) => conExpansiones.has(p)));
    })
    .map((n) => n.nombre);
  const categorias = [...new Set([...det.categorias, ...porSustantivo])].slice(0, MAX_CANDIDATAS);
  const exterior = tokens.some((t) => LUGARES_EXTERIOR.has(t)) && !det.atributos.includes("apto-exterior");
  const humedad = tokens.some((t) => LUGARES_HUMEDAD.has(t)) && !det.atributos.includes("apto-humedad");
  return {
    categorias,
    categoriasDeLuz,
    atributosExplicitos: det.atributos,
    atributosContexto: [...(exterior ? ["apto-exterior"] : []), ...(humedad ? ["apto-humedad"] : [])],
    absorbidos: det.absorbidos,
  };
}
