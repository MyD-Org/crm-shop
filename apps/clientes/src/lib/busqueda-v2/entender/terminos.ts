/**
 * Términos de una consulta, con peso, para Recuperar y Ordenar. Módulo puro.
 *
 * En la v2 las palabras de la consulta ya no filtran (AND): recuperan (OR) y
 * ordenan. Por eso importa cuáles recuperan: si "para", "luz" o "casa"
 * trajeran candidatos, traerían el catálogo entero. Cada token cae en uno de
 * estos baldes:
 *
 * - vacío ("para", "el", "que"): afuera;
 * - absorbido por un atributo explícito ("cálido", "e27", "ip65"): afuera, lo
 *   resuelve el atributo;
 * - contexto (lugares, verbos de pedido, "luz", "led", unidades) y el objeto
 *   de "iluminar X" / "ver X" (lo que se ilumina no es lo que se compra):
 *   `PESO_CONTEXTO`, sólo ordena;
 * - medida o número ("20", "2.5", "60x60"): `PESO_MEDIDA`, sólo ordena;
 * - el resto, significativo: peso 1, recupera y ordena.
 *
 * Las expansiones (sinónimos) recuperan con `PESO_EXPANSION`.
 */
import { raizPlural } from "../../catalogo-busqueda";
import { PALABRAS_VACIAS } from "../../busqueda-inteligente/residuo";
import { tokensDe } from "../../busqueda-inteligente/deterministico";
import { PESO_EXPANSION, expansiones } from "./sinonimos";

export const PESO_CONTEXTO = 0.3;
export const PESO_MEDIDA = 0.4;

/**
 * Lugares y ambientes: dónde va el producto, no qué es. Un lugar escrito junto a un producto
 * ("lampara de jardin") ordena con peso de contexto; para decidir si una categoría puede ser dura
 * (`terminosDeFrase`) cuenta como parte de la frase del producto.
 *
 * Quedan AFUERA las palabras que suelen nombrar un tipo de producto ("lámpara de escritorio",
 * "ventilador de techo", "aplique de pared", "lámpara de mesa", "lámpara de piso"): `escritorio`,
 * `mesa`, `techo`, `pared` y `piso` son términos significativos (peso 1). Tratarlas como contexto
 * hacía que "lampara de escritorio" se resolviera sólo por "lampara".
 */
export const LUGARES = new Set([
  "patio", "jardin", "living", "comedor", "cocina", "bano", "dormitorio", "habitacion", "cuarto", "pieza",
  "oficina", "local", "comercio", "negocio", "galpon", "deposito", "taller", "garage", "garaje", "cochera",
  "pileta", "piscina", "vereda", "fachada", "frente", "entrada", "escalera", "pasillo", "balcon", "terraza",
  "quincho", "parrilla", "casa", "departamento", "noche",
  "calle", "cancha", "padel", "futbol", "tenis", "reja", "parque", "auto", "exterior", "interior", "afuera",
  "adentro", "lugar", "ambiente", "galeria", "ducha", "lavadero",
]);

/** Contexto: no identifica un producto. En singular normalizado. */
export const CONTEXTO = new Set([
  ...LUGARES,
  // Luz en general: casi todo el catálogo es luz o LED.
  "led", "luz", "iluminacion", "iluminar", "ilumine", "alumbrar", "alumbre", "alumbrado",
  // Pedido, uso y preguntas.
  "quiero", "necesito", "busco", "buscando", "tenga", "tengo", "tengan", "sirva", "sirve", "usar", "uso",
  "poner", "colocar", "instalar", "instalo", "prenda", "prende", "encienda", "funcione", "venden", "vendan",
  "sacar", "ver", "medir", "leer", "gire", "pasa", "consume", "conviene", "puedo", "alguien", "sola", "solo",
  "cuanto", "cuanta", "varios", "varias", "cosa", "necesita", "hace", "falta", "desde",
  // Clima.
  "agua", "lluvia", "moje", "moja", "mojar", "mojen", "sol",
  // Adjetivos genéricos y colores de luz.
  "bueno", "buena", "barato", "barata", "economico", "economica", "potente", "fuerte", "grande", "chico",
  "chica", "pequeno", "pequena", "lindo", "linda", "moderno", "moderna", "mejor", "tipo", "modelo",
  "producto", "nuevo", "nueva", "comun", "blanca", "blanco", "amarilla", "amarillo", "silencioso",
  // Unidades escritas como palabra.
  "amper", "ampere", "amperes", "watt", "watts", "volt", "volts", "metro", "metros", "mm", "cm", "mts",
]);

/** ¿Es un lugar o ambiente (en singular normalizado, o plural)? */
export const esLugar = (texto: string): boolean => LUGARES.has(texto) || LUGARES.has(raizPlural(texto));

/**
 * Las palabras de la consulta que forman "la frase del producto": las significativas (peso 1) y los
 * lugares ("lampara de jardin"); no las expansiones, las medidas ni el contexto de pedido ("quiero",
 * "luz"). En el orden de la consulta. Con ellas se comprueba que una categoría dura no deje afuera
 * un producto que se llama exactamente como se pidió.
 */
export function terminosDeFrase(terminos: readonly Termino[]): string[] {
  return terminos.filter((t) => t.peso >= 1 || (t.peso === PESO_CONTEXTO && esLugar(t.texto))).map((t) => t.texto);
}

/** Verbos cuyo objeto es lo que se ilumina o se mira, no lo que se compra ("iluminar un cartel"). */
const VERBOS_DE_OBJETO = new Set(["iluminar", "ilumine", "alumbrar", "alumbre", "ver", "mirar"]);

/** Largo mínimo de un término significativo. */
const LARGO_MINIMO = 3;

export interface Termino {
  texto: string;
  peso: number;
}

/**
 * Términos de una consulta YA normalizada. `absorbidos`: tokens que tomó un
 * atributo explícito (ver `deterministico`). Sin repetidos (queda el peso
 * mayor), en el orden de la consulta y después las expansiones.
 */
export function terminosDe(consultaNorm: string, absorbidos: ReadonlySet<string> = new Set()): Termino[] {
  const tokens = tokensDe(consultaNorm);
  const salida = new Map<string, number>();
  const poner = (texto: string, peso: number) => salida.set(texto, Math.max(peso, salida.get(texto) ?? 0));
  let objetoDeVerbo = false;
  for (const t of tokens) {
    const raiz = raizPlural(t);
    if (VERBOS_DE_OBJETO.has(t)) {
      objetoDeVerbo = true;
      poner(t, PESO_CONTEXTO);
      continue;
    }
    if (PALABRAS_VACIAS.has(t) || absorbidos.has(t)) continue;
    if (/\d/.test(t)) {
      poner(t, PESO_MEDIDA);
      continue;
    }
    if (t.length < LARGO_MINIMO) continue;
    if (CONTEXTO.has(t) || CONTEXTO.has(raiz) || objetoDeVerbo) {
      objetoDeVerbo = false;
      poner(t, PESO_CONTEXTO);
      continue;
    }
    poner(t, 1);
  }
  // Las expansiones salen sólo de lo que no es contexto ni vacío (y de las frases).
  const significativos = tokens.filter((t) => (salida.get(t) ?? 0) >= 1).map(raizPlural);
  for (const e of expansiones(significativos, consultaNorm)) {
    if (!salida.has(e)) salida.set(e, PESO_EXPANSION);
  }
  return [...salida].map(([texto, peso]) => ({ texto, peso }));
}
