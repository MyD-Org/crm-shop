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
  "led", "usb", "tv", "rgb", "rgbw", "pvc", "ac", "dc", "wifi", "hdmi", "vga",
  "ip", "lan", "wan", "plc", "utp", "ftp", "stp", "ul", "iso", "iec", "tia",
  "eia", "poe", "ups", "nvr", "dvr", "xvr", "cctv", "ptz", "hd", "fhd", "uhd",
  "smd", "cob", "abs", "ce", "rohs", "din", "dmx", "dali", "ir", "sd", "cat",
  "rj", "awg", "iram", "nema", "bt", "nfc", "gps", "ai",
]);

/**
 * Palabras cortas del castellano que NO son siglas: sin esta lista, la
 * heurística de "hasta 3 letras = sigla" dejaría "DE" o "LUZ" en mayúscula.
 */
const PALABRAS_CORTAS = new Set([
  "a", "e", "o", "u", "y", "x", "al", "de", "el", "en", "la", "lo", "no", "su",
  "un", "con", "del", "las", "los", "mas", "más", "por", "sin", "una", "uno",
  "dos", "luz", "sol", "par", "pie", "red", "uso", "gas", "eje", "ojo", "max",
  "min", "mix", "set", "kit", "box", "pack", "tipo", "para", "doble", "tres",
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

/** Sólo letras y dígitos, en mayúscula: para comparar sin que estorbe la puntuación. */
const normalizarParaComparar = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * ¿El texto viene en MAYÚSCULAS SOSTENIDAS? Se tolera alguna minúscula suelta
 * (unidades como "305m" dentro de un nombre en mayúscula); si más de un 20 %
 * de las letras ya son minúsculas, el nombre se considera presentable.
 */
function estaEnMayusculas(texto: string): boolean {
  const letras = texto.match(/\p{L}/gu) ?? [];
  if (letras.length === 0) return false;
  const minusculas = letras.filter((l) => l !== l.toUpperCase()).length;
  return minusculas / letras.length <= 0.2;
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
  // Salta la puntuación inicial: "(100%" o "“LAMPARA".
  const i = palabra.search(/\p{L}/u);
  if (i < 0) return palabra.toLowerCase();
  return palabra.slice(0, i) + palabra.charAt(i).toUpperCase() + palabra.slice(i + 1).toLowerCase();
}

/** Una parte de palabra sin separadores internos ("ISO", "IEC", "24AWG"). */
function formatearParte(parte: string, marcaNormalizada: string | null, marcaDisplay: string | null): string {
  if (marcaNormalizada && normalizarParaComparar(parte) === marcaNormalizada) {
    return marcaDisplay ?? capitalizar(parte);
  }

  if (/\d/.test(parte)) {
    // Número con letras: unidad reconocida, o si no, código/medida que se
    // deja en mayúscula ("JDHU2909", "CAT5E", "24AWG").
    const nucleo = parte.replace(/[^\p{L}\p{N}.,"]/gu, "");
    const unidad = comoUnidadPegada(nucleo);
    return unidad ? parte.replace(nucleo, unidad) : parte.toUpperCase();
  }

  const clave = parte.replace(/[^\p{L}]/gu, "").toLowerCase();
  if (ACRONIMOS.has(clave)) return parte.toUpperCase();
  // Sigla corta que no está en la lista: hasta 3 letras y no es una palabra
  // del castellano ("UL", "NVR"), o sin ninguna vocal ("PCB", "HDMI").
  if (clave.length >= 2 && clave.length <= 3 && !PALABRAS_CORTAS.has(clave)) return parte.toUpperCase();
  if (clave.length >= 2 && clave.length <= 5 && !/[aeiouáéíóú]/.test(clave)) return parte.toUpperCase();

  return parte.toLowerCase();
}

/**
 * Nombre de producto listo para mostrar, en formato oración: la primera letra
 * en mayúscula y el resto en minúscula, preservando siglas, códigos de modelo,
 * unidades y la marca. No hace nada si el nombre no viene en MAYÚSCULAS
 * SOSTENIDAS (ya está presentable) o si está vacío.
 *
 * `marca`, si se pasa, es la marca YA formateada para mostrar (por ejemplo
 * con `formatMarca`): si una palabra del nombre coincide con ella, se
 * reemplaza por esa forma.
 */
export function formatNombreProducto(nombre: string, marca?: string | null): string {
  if (!nombre || !estaEnMayusculas(nombre)) return nombre;

  const marcaNormalizada = marca ? normalizarParaComparar(marca) : null;
  const marcaDisplay = marca ?? null;

  const resultado = nombre
    .split(/\s+/)
    .filter(Boolean)
    // "ISO/IEC", "USB-C", "AC/DC": cada parte se evalúa por separado.
    .map((token) =>
      token
        .split(/([/-])/)
        .map((parte) => (parte === "/" || parte === "-" ? parte : formatearParte(parte, marcaNormalizada, marcaDisplay)))
        .join("")
    )
    .join(" ");

  // Formato oración: mayúscula al principio y después de cada punto (si ahí
  // quedó una minúscula; una sigla o código ya viene en mayúscula).
  return resultado.replace(/(^|[.!?]\s+)([^\p{L}]*)(\p{L})/gu, (_, antes, medio, letra) => antes + medio + letra.toUpperCase());
}

/**
 * Descripción de producto lista para mostrar: el mismo formato oración que el
 * nombre, aplicado línea por línea para no perder los saltos de línea (la
 * ficha los respeta). Una línea que no viene en MAYÚSCULAS SOSTENIDAS queda
 * como está. Sólo display, igual que `formatNombreProducto`.
 */
export function formatDescripcionProducto(descripcion: string, marca?: string | null): string {
  return descripcion
    .split("\n")
    .map((linea) => (linea.trim() ? formatNombreProducto(linea.trim(), marca) : ""))
    .join("\n");
}
