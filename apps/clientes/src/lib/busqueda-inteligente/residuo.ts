/**
 * Vocabularios de la búsqueda inteligente: palabras vacías y léxico de
 * contexto (ambientes, usos y palabras genéricas que no identifican un
 * producto). Módulo puro; lo usan `publicable.ts`, `deterministico.ts` y la
 * búsqueda v2 (`entender/terminos.ts`).
 */

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
