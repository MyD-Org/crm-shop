/**
 * Medidas técnicas de una consulta ("termica 2x20", "lampara 9,5w e27", "tira led 12v 5m").
 * Módulo PURO: sin IO, sin Jev, sin estado y sin nada del admin (el vocabulario es un espejo y lo
 * hace cumplir `db/__fixtures__/medidas-dorados.json`).
 *
 * Lee la consulta CRUDA: `normalizarConsulta` convierte "9,5w" en "9 5w" y el valor se pierde. Quien
 * lo cablee (M3) tiene que pasarle la consulta tal como la escribió la persona.
 *
 * Es conservador a propósito: ante la duda no devuelve nada. Un valor inventado filtraría mal;
 * uno que falta lo cubre el texto. La CONFIANZA dice cuánto se puede apoyar en la lectura:
 * - alta: unidad explícita inequívoca, `NxM` en contexto de protección con M en la serie IEC,
 *   palabra de polos fuera de un cable, rango o comparador;
 * - media: heurística con contexto (mm en un cable, número suelto en una protección, AxB en un
 *   panel, "ma" sin diferencial);
 * - baja: hipótesis (un número suelto junto a "lámpara").
 * Solo la alta puede ser un filtro duro; la media solo ordena; la baja no se usa.
 *
 * El pipeline CONSUME tramos: cada trozo del texto lo lee una sola regla (el resto queda en blanco
 * para las que siguen). Todas las expresiones tienen repeticiones acotadas: sin backtracking
 * catastrófico, el tiempo es lineal en el largo (que además se acota).
 */
import {
  CLAVES_ENTERAS,
  CURVAS,
  DIMENSION_MM,
  RANGOS,
  SERIE_IEC,
  ZOCALOS,
  type ClaveMedida,
} from "../../catalogo-atributos-medida";

export { CURVAS, RANGOS, ZOCALOS };

export type OpMedida = "eq" | "lte" | "gte" | "entre";
export type Confianza = "alta" | "media" | "baja";
export type OrigenMedida = "unidad" | "rango" | "nxm-proteccion" | "nxm-cable" | "nxm-panel" | "palabra" | "contexto" | "hipotesis";

export interface Medida {
  clave: ClaveMedida;
  op: OpMedida;
  /** `eq`, `lte` y `gte`. Texto para `zocalo`, `curva` y `medidas_mm`; número para el resto. */
  valor?: number | string;
  /** Solo `entre`. */
  min?: number;
  max?: number;
  /** Unidad canónica ("W", "A", "mm²"); null donde no hay (polos, zócalo, curva, IP). */
  unidad: string | null;
  confianza: Confianza;
  origen: OrigenMedida;
  /** Trozos de la consulta (ya normalizados) de los que salió la medida. */
  tokens: string[];
  texto: string;
  /** Otras lecturas posibles del mismo valor (medidas_mm: centímetros o milímetros). */
  alternativas?: string[];
}

/**
 * Palabras que dan contexto. Son RAÍCES: el parser admite sufijos de género y número (termica,
 * termicas, termico, disyuntores…). Mismo contrato en el fixture.
 */
export const CONTEXTOS = {
  proteccion: ["termic", "termomagnetic", "disyuntor", "diferencial", "llave", "interruptor", "contactor", "automatic", "mcb", "breaker", "din", "curva", "icn"],
  cable: ["cable", "conductor", "cordon"],
  panel: ["panel", "gabinete", "caja", "bandeja", "marco"],
  luminaria: ["lampara", "lamparita", "foco", "bulbo", "dicroica"],
} as const;

const UNIDAD_CANONICA: Record<ClaveMedida, string | null> = {
  potencia_w: "W",
  temperatura_k: "K",
  ip: null,
  flujo_lm: "lm",
  tension_v: "V",
  zocalo: null,
  corriente_a: "A",
  polos: null,
  seccion_mm2: "mm²",
  medidas_mm: "mm",
  poder_corte_ka: "kA",
  curva: null,
  sensibilidad_ma: "mA",
  largo_m: "m",
  angulo_grados: "°",
};

/** Largo máximo que se lee: el resto se ignora (acota el tiempo y nadie busca con más). */
const MAX_CONSULTA = 500;

// ---------------------------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------------------------

/** Minúsculas, sin tildes, "×" y "²" normalizados y coma decimal entre dígitos ("9,5w" → "9.5w"). */
function preparar(q: string): string {
  return q
    .slice(0, MAX_CONSULTA)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/[×✕]/g, "x")
    .replace(/º/g, "°")
    .replace(/(\d),(?=\d)/g, "$1.")
    .replace(/\s+/g, " ")
    .trim();
}

/** Borde izquierdo: nada alfanumérico, punto, barra ni guion pegado antes ("DL-18W", "TM-2x16", "12/24v"). */
const L = "(?<![a-z0-9./-])";
/** Borde derecho: nada alfanumérico pegado ni "/" + algo ("14w/m", "5a/m"). */
const F = "(?![a-z0-9]|/[a-z0-9])";
/** Número: hasta 4 enteros y 4 decimales. */
const N = "\\d{1,4}(?:\\.\\d{1,4})?";

// ---------------------------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------------------------

const SUFIJOS = "(?:[ao]s?|e?s)?";
const reContexto = (raices: readonly string[]) => new RegExp(`(?<![a-z0-9])(?:${raices.join("|")})${SUFIJOS}(?![a-z0-9])`);
const RE_CTX_PROTECCION = reContexto(CONTEXTOS.proteccion);
const RE_CTX_CABLE = reContexto(CONTEXTOS.cable);
const RE_CTX_PANEL = reContexto(CONTEXTOS.panel);
const RE_CTX_LUMINARIA = reContexto(CONTEXTOS.luminaria);
const RE_CTX_SENSIBILIDAD = /(?<![a-z0-9])(?:diferencial|disyuntor|rcd|dif|sensibilidad)(?:es)?(?![a-z0-9])/;
/** Telecom / datos: "4P" son pares y "CAT 6A" no son amperes. */
const RE_CTX_TELECOM = /(?<![a-z0-9])(?:utp|ftp|sftp|rj ?\d+|cat ?[5-8]|coaxil|hdmi|usb)(?![a-z0-9])/;

interface Contextos {
  proteccion: boolean;
  cable: boolean;
  panel: boolean;
  luminaria: boolean;
  sensibilidad: boolean;
  telecom: boolean;
}

// ---------------------------------------------------------------------------------------------
// Estado de una lectura
// ---------------------------------------------------------------------------------------------

interface Candidata {
  medida: Medida;
  pos: number;
  orden: number;
}

interface Estado {
  /** Lo que queda sin leer: lo consumido se reemplaza por espacios (mismas posiciones). */
  resto: string;
  ctx: Contextos;
  cands: Candidata[];
  /** Claves que una lectura EXPLÍCITA ya reclamó (aunque haya salido inválida): no se adivinan. */
  explicitas: Set<ClaveMedida>;
  orden: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function enRango(clave: ClaveMedida, n: number): boolean {
  if (!Number.isFinite(n)) return false;
  const r = RANGOS[clave];
  if (r && (n < r[0] || n > r[1])) return false;
  if ((CLAVES_ENTERAS as readonly string[]).includes(clave) && !Number.isInteger(n)) return false;
  return true;
}

interface Datos {
  clave: ClaveMedida;
  op: OpMedida;
  valor?: number | string;
  min?: number;
  max?: number;
  confianza: Confianza;
  origen: OrigenMedida;
  pos: number;
  tokens: string[];
  alternativas?: string[];
}

/** Agrega una medida si su valor es válido para la clave. */
function agregar(est: Estado, d: Datos): void {
  const numeros = [d.valor, d.min, d.max].filter((x): x is number => typeof x === "number");
  if (numeros.some((n) => !enRango(d.clave, n))) return;
  if (d.op === "entre" && !(d.min! < d.max!)) return;
  const medida: Medida = {
    clave: d.clave,
    op: d.op,
    ...(d.valor !== undefined ? { valor: d.valor } : {}),
    ...(d.min !== undefined ? { min: d.min } : {}),
    ...(d.max !== undefined ? { max: d.max } : {}),
    unidad: UNIDAD_CANONICA[d.clave],
    confianza: d.confianza,
    origen: d.origen,
    tokens: d.tokens,
    texto: d.tokens.join(" "),
    ...(d.alternativas ? { alternativas: d.alternativas } : {}),
  };
  est.cands.push({ medida, pos: d.pos, orden: est.orden++ });
}

/**
 * Recorre `re` (global) sobre el resto; para cada coincidencia llama a `alVer`. Si devuelve `false`
 * la coincidencia NO se consume; si no, ese tramo queda en blanco para las reglas que siguen.
 */
function consumir(est: Estado, re: RegExp, alVer: (m: RegExpExecArray) => boolean | void): void {
  const base = est.resto;
  const tramos: [number, number][] = [];
  re.lastIndex = 0;
  for (let m = re.exec(base); m !== null; m = re.exec(base)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (alVer(m) !== false) tramos.push([m.index, m.index + m[0].length]);
  }
  if (tramos.length === 0) return;
  let salida = "";
  let desde = 0;
  for (const [a, b] of tramos) {
    salida += base.slice(desde, a) + " ".repeat(b - a);
    desde = b;
  }
  est.resto = salida + base.slice(desde);
}

// ---------------------------------------------------------------------------------------------
// Unidades
// ---------------------------------------------------------------------------------------------

/** Unidades que admiten rango y comparador. Las más largas primero. */
const U =
  "kw|ka|ma|mm2|mts|mt|metros|metro|m|lm|lumenes|lumen|watts|watt|w|amperios|amperes|amperio|amper|amps|amp|a|vca|vac|vcc|vdc|volts|volt|v|k|grados|grado|°";

function porUnidad(u: string): { clave: ClaveMedida; mult: number } | null {
  switch (u) {
    case "w":
    case "watt":
    case "watts":
      return { clave: "potencia_w", mult: 1 };
    case "kw":
      return { clave: "potencia_w", mult: 1000 };
    case "a":
    case "amp":
    case "amps":
    case "amper":
    case "amperes":
    case "amperio":
    case "amperios":
      return { clave: "corriente_a", mult: 1 };
    case "v":
    case "vca":
    case "vac":
    case "vcc":
    case "vdc":
    case "volt":
    case "volts":
      return { clave: "tension_v", mult: 1 };
    case "ka":
      return { clave: "poder_corte_ka", mult: 1 };
    case "ma":
      return { clave: "sensibilidad_ma", mult: 1 };
    case "mm2":
      return { clave: "seccion_mm2", mult: 1 };
    case "m":
    case "mt":
    case "mts":
    case "metro":
    case "metros":
      return { clave: "largo_m", mult: 1 };
    case "lm":
    case "lumen":
    case "lumenes":
      return { clave: "flujo_lm", mult: 1 };
    case "k":
      return { clave: "temperatura_k", mult: 1 };
    case "°":
    case "grado":
    case "grados":
      return { clave: "angulo_grados", mult: 1 };
    default:
      return null;
  }
}

const valorConUnidad = (n: number, mult: number) => (mult === 1 ? n : r2(n * mult));

// Lo "por unidad" y la eficiencia no son la medida del producto: se borran antes de leer nada.
const RE_EFICIENCIA = new RegExp(`${L}(?:${N} ?)?(?:lm|lumenes?) ?(?:/|por) ?(?:w|watts?)(?![a-z0-9])`, "g");
const RE_POR_UNIDAD = new RegExp(
  `${L}(?:${N} ?)?(?:k?w|watts?|lm|lumenes?|a|amps?|v|ma|ka) ?/ ?(?:m|mt|mts|metros?|m2|cm|mm|h)(?![a-z0-9])`,
  "g",
);

// Rangos y comparadores.
const RE_RANGO_PREFIJO = new RegExp(`${L}(?:de|desde|entre) (${N})(?: ?(${U}))? ?(?:a|y|hasta|-) ?(${N}) ?(${U})${F}`, "g");
const RE_RANGO_GUION = new RegExp(`${L}(${N})(?: ?(${U}))? ?[-–] ?(${N}) ?(${U})${F}`, "g");
const RE_COMPARADOR = new RegExp(
  `${L}(?:(hasta|maximo|max|menos de|menor a|menor que|menor de)|(desde|minimo|min|mas de|mayor a|mayor que|mayor de|al menos)) (${N}) ?(${U})${F}`,
  "g",
);

const RE_IP = new RegExp(`${L}ip ?-?(\\d{2})${F}`, "g");
const RE_ZOCALO = new RegExp(
  `${L}(e ?-?(?:10|12|14|27|40)|gu ?-?(?:10|5\\.3)|mr ?-?(?:11|16)|gx ?-?53|g ?-?(?:4|9|13|24)|r7s)${F}`,
  "g",
);
const RE_CURVA_EXPLICITA = new RegExp(`${L}curva ?([a-z])${F}`, "g");
const RE_CURVA_COMBINADA = new RegExp(`${L}([bcd]) ?-?(\\d{1,3})(?: ?a)?${F}`, "g");
const RE_KA = new RegExp(`${L}(${N}) ?ka${F}`, "g");
const RE_MA = new RegExp(`${L}(\\d{1,4}) ?ma${F}`, "g");
const RE_MM2 = new RegExp(`${L}(?:\\d{1,2} ?x ?)?(${N}) ?mm2${F}`, "g");
const RE_LM = new RegExp(`${L}(\\d{1,3}(?:\\.\\d{3})+|\\d{1,7}) ?(?:lm|lumenes|lumen)${F}`, "g");
const RE_GRADOS = new RegExp(`${L}(\\d{1,3}) ?(?:°|grados?|deg)${F}`, "g");
const RE_KELVIN = new RegExp(`${L}(\\d{4}) ?°? ?k${F}`, "g");
const RE_POTENCIA = new RegExp(`${L}(${N}) ?(k?)(?:watts?|vatios?|w)${F}`, "g");
const RE_TENSION = new RegExp(`${L}(?:(?:ac|dc) ?)?(${N}) ?(?:vca|vac|vcc|vdc|volts?|v)${F}`, "g");
const RE_NXM = new RegExp(
  `${L}(\\d{1,4}(?:\\.\\d{1,2})?(?: ?x ?\\d{1,4}(?:\\.\\d{1,2})?){1,2})(?: ?(cm|mm2|mm|amperes|amperios|amps|amp|a))?${F}`,
  "g",
);
const RE_POLOS_P = new RegExp(`${L}([1-4]) ?p${F}(?! ?\\+)`, "g");
const RE_POLOS_PALABRA = new RegExp(`${L}(uni|bi|tri|tetra)polar(?:es)?${F}`, "g");
// "20a", "20 a" al final (nunca una "a" seguida de otro número: es preposición), "20 amperes".
const RE_CORRIENTE = new RegExp(`${L}(${N})(?: ?(?:amperes|amperios|amperio|amper|amps|amp)| a(?! ?\\d)|a)${F}`, "g");
// "25M" dentro de un código ("NCH8-25M/20") no es un largo.
const RE_LARGO = new RegExp(`${L}(${N}) ?(?:metros|metro|mts|mt|m)${F}(?![-][a-z0-9])`, "g");
const RE_MM = new RegExp(`${L}(${N}) ?mm${F}`, "g");
const RE_SUELTO = new RegExp(`${L}(\\d{1,3}(?:\\.\\d{1,2})?)${F}`, "g");

const POLOS_DE_PALABRA: Record<string, number> = { uni: 1, bi: 2, tri: 3, tetra: 4 };

function leerRangos(est: Estado): void {
  const alVer = (m: RegExpExecArray) => {
    const [, n1, u1, n2, u2] = m;
    const fin = porUnidad(u2);
    const ini = u1 ? porUnidad(u1) : fin;
    if (!fin || !ini || fin.clave !== ini.clave) return false;
    est.explicitas.add(fin.clave);
    agregar(est, {
      clave: fin.clave,
      op: "entre",
      min: valorConUnidad(Number(n1), ini.mult),
      max: valorConUnidad(Number(n2), fin.mult),
      confianza: "alta",
      origen: "rango",
      pos: m.index,
      tokens: [m[0]],
    });
  };
  consumir(est, RE_RANGO_PREFIJO, alVer);
  consumir(est, RE_RANGO_GUION, alVer);
  consumir(est, RE_COMPARADOR, (m) => {
    const [, menor, , n, u] = m;
    const un = porUnidad(u);
    if (!un) return false;
    est.explicitas.add(un.clave);
    agregar(est, {
      clave: un.clave,
      op: menor ? "lte" : "gte",
      valor: valorConUnidad(Number(n), un.mult),
      confianza: "alta",
      origen: "rango",
      pos: m.index,
      tokens: [m[0]],
    });
  });
}

/** Una medida numérica con unidad explícita (eq, confianza alta salvo que se indique). */
function unidad(
  est: Estado,
  re: RegExp,
  clave: ClaveMedida,
  valorDe: (m: RegExpExecArray) => number,
  confianza: (m: RegExpExecArray) => Confianza = () => "alta",
): void {
  consumir(est, re, (m) => {
    est.explicitas.add(clave);
    agregar(est, { clave, op: "eq", valor: valorDe(m), confianza: confianza(m), origen: "unidad", pos: m.index, tokens: [m[0]] });
  });
}

function leerUnidades(est: Estado): void {
  consumir(est, RE_IP, (m) => {
    est.explicitas.add("ip");
    agregar(est, { clave: "ip", op: "eq", valor: Number(m[1]), confianza: "alta", origen: "unidad", pos: m.index, tokens: [m[0]] });
  });
  consumir(est, RE_ZOCALO, (m) => {
    est.explicitas.add("zocalo");
    const valor = m[1].replace(/[ -]/g, "");
    if ((ZOCALOS as readonly string[]).includes(valor))
      agregar(est, { clave: "zocalo", op: "eq", valor, confianza: "alta", origen: "unidad", pos: m.index, tokens: [m[0]] });
  });
  consumir(est, RE_CURVA_EXPLICITA, (m) => {
    est.explicitas.add("curva");
    if ((CURVAS as readonly string[]).includes(m[1]))
      agregar(est, { clave: "curva", op: "eq", valor: m[1], confianza: "alta", origen: "unidad", pos: m.index, tokens: [m[0]] });
  });
  // "c16": curva + corriente, solo con contexto de protección y corriente de la serie IEC.
  consumir(est, RE_CURVA_COMBINADA, (m) => {
    const corriente = Number(m[2]);
    if (!est.ctx.proteccion || !SERIE_IEC.includes(corriente)) return false;
    est.explicitas.add("curva");
    est.explicitas.add("corriente_a");
    agregar(est, { clave: "curva", op: "eq", valor: m[1], confianza: "alta", origen: "contexto", pos: m.index, tokens: [m[0]] });
    agregar(est, { clave: "corriente_a", op: "eq", valor: corriente, confianza: "alta", origen: "contexto", pos: m.index, tokens: [m[0]] });
  });
  unidad(est, RE_KA, "poder_corte_ka", (m) => Number(m[1]));
  unidad(est, RE_MA, "sensibilidad_ma", (m) => Number(m[1]), () => (est.ctx.sensibilidad ? "alta" : "media"));
  unidad(est, RE_MM2, "seccion_mm2", (m) => Number(m[1]));
  unidad(est, RE_LM, "flujo_lm", (m) => Number(m[1].replace(/\./g, "")));
  unidad(est, RE_GRADOS, "angulo_grados", (m) => Number(m[1]));
  unidad(est, RE_KELVIN, "temperatura_k", (m) => Number(m[1]));
  unidad(est, RE_POTENCIA, "potencia_w", (m) => valorConUnidad(Number(m[1]), m[2] ? 1000 : 1));
  unidad(est, RE_TENSION, "tension_v", (m) => Number(m[1]));
}

const fmtDim = (n: number) => String(r2(n));

/** `NxM` según el contexto (protección, cable o panel). Sin contexto no se interpreta. */
function leerNxM(est: Estado): void {
  const { ctx } = est;
  if (!ctx.cable && !ctx.proteccion && !ctx.panel) return;
  consumir(est, RE_NXM, (m) => {
    const dims = m[1].split(/ ?x ?/).map(Number);
    const sufijo = m[2];
    const pos = m.index;
    const tokens = [m[0]];
    const esAmperes = sufijo === undefined || sufijo === "a" || sufijo.startsWith("amp");

    if (ctx.cable) {
      // Conductores x sección: la sección es lo que se busca; la cantidad de conductores no es una clave.
      if (dims.length === 2 && (sufijo === undefined || sufijo === "mm")) {
        est.explicitas.add("seccion_mm2");
        agregar(est, { clave: "seccion_mm2", op: "eq", valor: dims[1], confianza: "media", origen: "nxm-cable", pos, tokens });
      }
      return;
    }
    if (ctx.proteccion) {
      if (dims.length === 2 && esAmperes && Number.isInteger(dims[0]) && dims[0] >= 1 && dims[0] <= 4 && Number.isInteger(dims[1]) && SERIE_IEC.includes(dims[1])) {
        est.explicitas.add("polos");
        est.explicitas.add("corriente_a");
        agregar(est, { clave: "polos", op: "eq", valor: dims[0], confianza: "alta", origen: "nxm-proteccion", pos, tokens });
        agregar(est, { clave: "corriente_a", op: "eq", valor: dims[1], confianza: "alta", origen: "nxm-proteccion", pos, tokens });
      }
      return;
    }
    // Panel: sin unidad AxB con ambos < 100 son centímetros; con ambos >= 100, milímetros.
    if (sufijo !== undefined && sufijo !== "cm" && sufijo !== "mm") return;
    const literal = dims.map(fmtDim).join("x");
    let valor: string;
    let alternativas: string[] | undefined;
    if (sufijo === "cm") valor = dims.map((d) => fmtDim(d * 10)).join("x");
    else if (sufijo === "mm") valor = literal;
    else if (dims.every((d) => d < 100)) {
      valor = dims.map((d) => fmtDim(d * 10)).join("x");
      alternativas = [literal];
    } else if (dims.every((d) => d >= 100)) valor = literal;
    else return;
    const enLimite = valor.split("x").every((d) => Number(d) >= DIMENSION_MM[0] && Number(d) <= DIMENSION_MM[1]);
    if (!enLimite) return;
    est.explicitas.add("medidas_mm");
    agregar(est, { clave: "medidas_mm", op: "eq", valor, confianza: "media", origen: "nxm-panel", pos, tokens, alternativas });
  });
}

function leerPolos(est: Estado): void {
  // En un cable "unipolar" es el tipo de conductor, no los polos de una protección; en telecom, pares.
  if (est.ctx.cable || est.ctx.telecom) return;
  consumir(est, RE_POLOS_P, (m) => {
    est.explicitas.add("polos");
    agregar(est, { clave: "polos", op: "eq", valor: Number(m[1]), confianza: "alta", origen: "palabra", pos: m.index, tokens: [m[0]] });
  });
  consumir(est, RE_POLOS_PALABRA, (m) => {
    est.explicitas.add("polos");
    agregar(est, { clave: "polos", op: "eq", valor: POLOS_DE_PALABRA[m[1]], confianza: "alta", origen: "palabra", pos: m.index, tokens: [m[0]] });
  });
}

function leerCorrienteYLargo(est: Estado): void {
  consumir(est, RE_CORRIENTE, (m) => {
    est.explicitas.add("corriente_a");
    if (est.ctx.telecom) return;
    agregar(est, { clave: "corriente_a", op: "eq", valor: Number(m[1]), confianza: "alta", origen: "unidad", pos: m.index, tokens: [m[0]] });
  });
  unidad(est, RE_LARGO, "largo_m", (m) => Number(m[1]));
  // Los milímetros solos son ambiguos (caño, tornillo): solo cuentan como sección dentro de un cable.
  if (est.ctx.cable)
    consumir(est, RE_MM, (m) => {
      est.explicitas.add("seccion_mm2");
      agregar(est, { clave: "seccion_mm2", op: "eq", valor: Number(m[1]), confianza: "media", origen: "contexto", pos: m.index, tokens: [m[0]] });
    });
}

/** Un número suelto solo se adivina para una clave que ninguna lectura explícita reclamó. */
function leerSueltos(est: Estado): void {
  const { ctx, explicitas } = est;
  const corriente = ctx.proteccion && !ctx.telecom && !explicitas.has("corriente_a");
  const potencia = ctx.luminaria && !explicitas.has("potencia_w");
  if (!corriente && !potencia) return;
  const base = est.resto;
  RE_SUELTO.lastIndex = 0;
  for (let m = RE_SUELTO.exec(base); m !== null; m = RE_SUELTO.exec(base)) {
    const valor = Number(m[1]);
    const tokens = [m[0]];
    if (corriente && Number.isInteger(valor) && SERIE_IEC.includes(valor))
      agregar(est, { clave: "corriente_a", op: "eq", valor, confianza: "media", origen: "hipotesis", pos: m.index, tokens });
    if (potencia) agregar(est, { clave: "potencia_w", op: "eq", valor, confianza: "baja", origen: "hipotesis", pos: m.index, tokens });
  }
}

const PESO_CONFIANZA: Record<Confianza, number> = { alta: 3, media: 2, baja: 1 };

/**
 * Dos valores DISTINTOS de la misma clave sin marcador de rango = ninguno de esa clave (heredado del
 * extractor del CRM). El mismo valor repetido es uno (el de mayor confianza). Un rango o un comparador
 * no cuentan como valor distinto.
 */
function resolver(cands: Candidata[]): Candidata[] {
  const eqPorClave = new Map<ClaveMedida, Candidata[]>();
  for (const c of cands) {
    if (c.medida.op !== "eq") continue;
    const lista = eqPorClave.get(c.medida.clave) ?? [];
    lista.push(c);
    eqPorClave.set(c.medida.clave, lista);
  }
  const descartar = new Set<Candidata>();
  for (const lista of eqPorClave.values()) {
    const valores = new Set(lista.map((c) => String(c.medida.valor)));
    if (valores.size > 1) {
      for (const c of lista) descartar.add(c);
      continue;
    }
    const mejor = lista.reduce((a, b) => (PESO_CONFIANZA[b.medida.confianza] > PESO_CONFIANZA[a.medida.confianza] ? b : a));
    for (const c of lista) if (c !== mejor) descartar.add(c);
  }
  return cands.filter((c) => !descartar.has(c));
}

/**
 * Medidas de la consulta CRUDA, en orden de aparición. Total: nunca lanza.
 */
export function medidasDeConsulta(consultaCruda: string): Medida[] {
  if (typeof consultaCruda !== "string") return [];
  try {
    const t = preparar(consultaCruda);
    if (!t) return [];
    const est: Estado = {
      resto: t,
      ctx: {
        proteccion: RE_CTX_PROTECCION.test(t),
        cable: RE_CTX_CABLE.test(t),
        panel: RE_CTX_PANEL.test(t),
        luminaria: RE_CTX_LUMINARIA.test(t),
        sensibilidad: RE_CTX_SENSIBILIDAD.test(t),
        telecom: RE_CTX_TELECOM.test(t),
      },
      cands: [],
      explicitas: new Set(),
      orden: 0,
    };
    consumir(est, RE_EFICIENCIA, () => true);
    consumir(est, RE_POR_UNIDAD, () => true);
    leerRangos(est);
    leerUnidades(est);
    leerNxM(est);
    leerPolos(est);
    leerCorrienteYLargo(est);
    leerSueltos(est);
    return resolver(est.cands)
      .sort((a, b) => a.pos - b.pos || a.orden - b.orden)
      .map((c) => c.medida);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------------------------

/** `2x20`, `4x16a`: lexical, sin contexto. */
const RE_NXM_TOKEN = /^\d{1,2}x\d{1,3}a?$/;
/** `60x60`, `120x240`. */
const RE_AXB_TOKEN = /^\d{2,4}x\d{2,4}$/;

/**
 * ¿Este token suelto ES una medida y no un código de producto? ("20a", "ip65", "e27", "9w", "2x20").
 * Forma léxica + validación de rango con el parser: "12000k", "ip70" y "9999999w" siguen siendo
 * código. `NxM` es puramente léxico (no hay contexto en una palabra sola). Lo que tiene guion,
 * barra o un prefijo de letras ("DL-18W", "TM-2x16", "XQ-4471B", "c16") nunca es medida.
 *
 * Lo usa `pareceCodigo` (gate.ts): un token que es medida deja de contar como código.
 */
export function esTokenMedida(token: string): boolean {
  if (typeof token !== "string") return false;
  const t = preparar(token);
  if (!t || t.length > 24 || /\s/.test(t)) return false;
  if (RE_NXM_TOKEN.test(t) || RE_AXB_TOKEN.test(t)) return true;
  return medidasDeConsulta(t).length > 0;
}
