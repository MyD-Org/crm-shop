/**
 * Qué queda de la consulta después de interpretarla. Módulo puro.
 *
 * Aplicar una interpretación reemplaza la búsqueda por filtros. Si en ese paso
 * se pierde una palabra que importa ("lampara para PECERA de agua salada" →
 * todas las Lámparas), el visitante ve 770 productos que no pidió. Por eso el
 * texto residual se queda con:
 * - los tokens con dígitos que ningún atributo absorbió ("50w");
 * - los tokens SIGNIFICATIVOS: los que ninguna categoría ni atributo aplicado
 *   absorbió y que no son palabras vacías ni contexto (ambientes, usos o
 *   palabras genéricas que la interpretación ya tradujo o que no filtran).
 * Quien lo usa verifica que la búsqueda con ese residual traiga algo antes de
 * redirigir.
 */
import { raizPlural } from "../catalogo-busqueda";
import { palabrasCategoria, tokensDe } from "./deterministico";

/** Palabras vacías del español que aparecen en una búsqueda escrita como frase. */
export const PALABRAS_VACIAS = new Set([
  "a", "al", "algo", "como", "con", "cual", "cuando", "de", "del", "donde", "e", "el", "ella", "en", "es",
  "esa", "ese", "eso", "esta", "este", "esto", "hay", "la", "las", "le", "les", "lo", "los", "mas", "me",
  "mi", "mis", "muy", "no", "o", "para", "pero", "por", "que", "se", "sea", "si", "sin", "son", "su", "sus",
  "tan", "te", "un", "una", "uno", "unos", "unas", "y", "ya",
]);

/**
 * Contexto que no filtra por texto: ambientes y lugares (lo traduce el
 * atributo "apto exterior" o la categoría), usos y verbos de pedido, clima y
 * adjetivos genéricos. Todo en singular normalizado (se compara con `raizPlural`).
 */
export const LEXICO_CONTEXTO = new Set([
  // Ambientes y lugares.
  "patio", "jardin", "living", "comedor", "cocina", "bano", "dormitorio", "habitacion", "cuarto", "pieza",
  "oficina", "local", "comercio", "negocio", "galpon", "deposito", "taller", "garage", "garaje", "cochera",
  "pileta", "piscina", "vereda", "fachada", "frente", "entrada", "escalera", "pasillo", "balcon", "terraza",
  "quincho", "parrilla", "exterior", "interior", "afuera", "adentro", "casa", "departamento", "techo",
  "pared", "piso", "mesa", "escritorio", "noche", "calle",
  // Luz en general (la categoría o el atributo ya lo dicen; casi todo es LED).
  "led", "luz", "iluminacion", "iluminar", "ilumine", "alumbrar", "alumbre", "lampara", "amarilla", "amarillo",
  "blanca", "blanco",
  // Pedido y uso.
  "quiero", "necesito", "busco", "buscando", "tenga", "tengo", "tengan", "sirva", "sirve", "usar", "uso",
  "poner", "colocar", "instalar", "prenda", "prende", "encienda", "funcione", "venden", "vendan",
  // Clima (lo traduce "apto exterior").
  "agua", "lluvia", "moje", "moja", "mojar", "mojen", "humedad", "sol", "intemperie",
  // Adjetivos genéricos.
  "cosa", "bueno", "buena", "barato", "barata", "economico", "economica", "potente", "fuerte", "grande",
  "chico", "chica", "pequeno", "pequena", "lindo", "linda", "moderno", "moderna", "mejor", "tipo", "modelo",
  "producto", "nuevo", "nueva", "comun",
]);

/** Largo mínimo de un token significativo (menos es ruido: "tv", "x"). */
const LARGO_MINIMO = 3;

/**
 * Tokens significativos que la interpretación NO absorbió, en el orden de la
 * consulta. `absorbidos`: los que tomó un atributo; `categorias`: las
 * categorías aplicadas (sus palabras, en singular, también quedan absorbidas).
 */
export function tokensSignificativos(
  consultaNorm: string,
  absorbidos: ReadonlySet<string>,
  categorias: readonly string[],
): string[] {
  const deCategorias = new Set(categorias.flatMap(palabrasCategoria));
  return tokensDe(consultaNorm).filter((t) => {
    if (/\d/.test(t) || t.length < LARGO_MINIMO || absorbidos.has(t)) return false;
    const raiz = raizPlural(t);
    return !PALABRAS_VACIAS.has(t) && !LEXICO_CONTEXTO.has(t) && !LEXICO_CONTEXTO.has(raiz) && !deCategorias.has(raiz);
  });
}

/**
 * Texto residual al aplicar una interpretación: tokens con dígitos no
 * absorbidos por un atributo ("50w") y tokens significativos ("pecera"), en
 * el orden de la consulta. `undefined` si no queda nada.
 */
export function residuoDeBusqueda(
  consultaNorm: string,
  absorbidos: ReadonlySet<string>,
  categorias: readonly string[],
): string | undefined {
  const significativos = new Set(tokensSignificativos(consultaNorm, absorbidos, categorias));
  const quedan = tokensDe(consultaNorm).filter(
    (t) => significativos.has(t) || (/\d/.test(t) && !absorbidos.has(t)),
  );
  return quedan.length ? [...new Set(quedan)].join(" ") : undefined;
}
