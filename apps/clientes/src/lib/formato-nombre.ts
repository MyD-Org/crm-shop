/**
 * Formateo del nombre de producto para mostrar. Alegra guarda el nombre
 * comercial en MAYÚSCULAS SOSTENIDAS ("LAMPARA LED PANEL 12V IP65 JADEVER
 * A60") y en el diseño se lee como un título normal ("Lampara LED Panel 12V
 * IP65 Jadever A60"): sólo la primera letra de cada palabra en mayúscula,
 * salvo lo que tiene que seguir en mayúscula porque es una sigla, un código
 * de modelo o una unidad pegada a un número.
 *
 * Sólo display: nunca se usa para buscar, ordenar ni en `nombreExhibidoSql`
 * (ver src/lib/nombre-exhibido.ts) — ahí el dato sigue siendo el crudo del
 * CRM/Alegra, porque cambiarlo rompería el matching contra la URL y el
 * `ORDER BY` en Postgres.
 */

/** Siglas que se leen en mayúscula aunque el resto del nombre se formatee. */
const ACRONIMOS = new Set([
  "led",
  "usb",
  "usb-c",
  "tv",
  "rgb",
  "rgbw",
  "pvc",
  "ac",
  "dc",
  "ac/dc",
  "wifi",
  "wi-fi",
  "hdmi",
  "vga",
  "ip",
  "lan",
  "wan",
  "plc",
  "led/rgb",
]);

/** Unidades que van pegadas a un número, en su forma canónica de escritura. */
const UNIDADES: Record<string, string> = {
  v: "V",
  w: "W",
  a: "A",
  k: "K",
  hz: "Hz",
  va: "VA",
  kv: "kV",
  mm: "mm",
  cm: "cm",
  m: "m",
  ml: "ml",
  l: "L",
  kg: "kg",
  g: "g",
};

/** Vocales (con y sin tilde) para la heurística de siglas cortas. */
const VOCALES = /[AEIOUÁÉÍÓÚ]/i;

/** Sólo letras y dígitos, en mayúscula: para comparar sin que estorbe la puntuación. */
const normalizarParaComparar = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** ¿El texto ya tiene alguna minúscula? Si la tiene, se deja como está. */
function tieneMinuscula(texto: string): boolean {
  return /[a-záéíóúñü]/.test(texto);
}

/**
 * Un número seguido de letras (o de `"` para pulgadas): `12V`, `220V`,
 * `4000K`, `25mm`, `1/2"`. Si la unidad se reconoce, la devuelve en su forma
 * canónica; si no (un código como `02141N`), devuelve `null` y el llamador
 * deja el token como estaba.
 */
function comoUnidadPegada(token: string): string | null {
  const m = /^(\d+(?:[.,]\d+)?)([a-zA-Z]+)$/.exec(token);
  if (!m) return null;
  const unidad = UNIDADES[m[2].toLowerCase()];
  return unidad ? `${m[1]}${unidad}` : null;
}

function capitalizar(palabra: string): string {
  return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
}

/**
 * Formatea un token (palabra) del nombre. `marca` ya viene normalizada
 * (`normalizarParaComparar`) para no repetir el trabajo por cada palabra.
 */
function formatearToken(token: string, marcaNormalizada: string | null, marcaDisplay: string | null): string {
  if (marcaNormalizada && normalizarParaComparar(token) === marcaNormalizada) {
    return marcaDisplay ?? capitalizar(token);
  }

  if (/\d/.test(token)) {
    // Número con letras: unidad reconocida, o si no, código/medida que se
    // deja tal cual vino (en mayúscula, como el resto de las siglas).
    return comoUnidadPegada(token) ?? token.toUpperCase();
  }

  const soloLetras = token.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ]/g, "");
  const clave = soloLetras.toLowerCase();
  if (ACRONIMOS.has(clave) || ACRONIMOS.has(token.toLowerCase())) {
    return token.toUpperCase();
  }
  // Sigla corta sin vocales que no está en la lista (p. ej. "PVC", "TV",
  // "RGB" ya cubiertas arriba, pero cualquier otra combinación parecida).
  if (soloLetras.length >= 2 && soloLetras.length <= 5 && !VOCALES.test(soloLetras)) {
    return token.toUpperCase();
  }

  return capitalizar(token);
}

/**
 * Nombre de producto listo para mostrar: primera letra en mayúscula por
 * palabra, preservando siglas, códigos de modelo y unidades. No hace nada
 * si el nombre ya tiene alguna minúscula (ya está presentable) o si está
 * vacío.
 *
 * `marca`, si se pasa, es la marca YA formateada para mostrar (por ejemplo
 * con `formatMarca`): si una palabra del nombre coincide con ella, se
 * reemplaza por esa forma en vez de titular la palabra a mano.
 */
export function formatNombreProducto(nombre: string, marca?: string | null): string {
  if (!nombre || tieneMinuscula(nombre)) return nombre;

  const marcaNormalizada = marca ? normalizarParaComparar(marca) : null;
  const marcaDisplay = marca ?? null;

  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => formatearToken(token, marcaNormalizada, marcaDisplay))
    .join(" ");
}
