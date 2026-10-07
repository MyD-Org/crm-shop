/**
 * Medidas técnicas como ids dinámicos de atributo (`corriente_a:20`, `polos:2`, `potencia_w:8-10`).
 * Módulo puro, sin IO: lo comparten el parser de la consulta (busqueda-v2/entender/medidas.ts) y,
 * más adelante, la resolución de ids (`catalogo-atributos.ts`).
 *
 * El vocabulario (claves, rangos, zócalos, curvas) es un ESPEJO del extractor del CRM
 * (`apps/admin/src/lib/catalogo-atributos-extraccion.ts`); el contrato vive en
 * `db/__fixtures__/medidas-dorados.json` y lo hacen cumplir un test en cada app.
 */
import type { CriterioEstructurado } from "./catalogo-atributos";
import { CLAVES_ESTRUCTURADAS, type ClaveEstructurada } from "./catalogo-caracteristicas";

/** Claves que el buscador sabe leer de una consulta (subconjunto de las claves estructuradas). */
const CLAVES_LEIBLES = [
  "potencia_w",
  "temperatura_k",
  "ip",
  "flujo_lm",
  "tension_v",
  "zocalo",
  "corriente_a",
  "polos",
  "seccion_mm2",
  "medidas_mm",
  "poder_corte_ka",
  "curva",
  "sensibilidad_ma",
  "largo_m",
  "angulo_grados",
] as const satisfies readonly ClaveEstructurada[];

/** Mismo orden que `CLAVES_ESTRUCTURADAS`. */
export const CLAVES_MEDIDA: readonly ClaveMedida[] = CLAVES_ESTRUCTURADAS.filter((c): c is ClaveMedida =>
  (CLAVES_LEIBLES as readonly string[]).includes(c),
);
export type ClaveMedida = (typeof CLAVES_LEIBLES)[number];

export const esClaveMedida = (c: string): c is ClaveMedida => (CLAVES_MEDIDA as readonly string[]).includes(c);

/**
 * Rango válido de cada clave numérica (lo que sale de ahí no es una medida). Espejo de
 * `DEFINICION_ATRIBUTOS.rango` del CRM, salvo `ip`: el CRM declara 0-69 y acá solo se aceptan 10-69.
 */
export const RANGOS: Readonly<Partial<Record<ClaveMedida, readonly [number, number]>>> = {
  potencia_w: [0.1, 100_000],
  temperatura_k: [1800, 10_000],
  ip: [10, 69],
  flujo_lm: [1, 1_000_000],
  tension_v: [1, 1000],
  corriente_a: [0.1, 6300],
  polos: [1, 4],
  seccion_mm2: [0.5, 1000],
  poder_corte_ka: [1, 100],
  sensibilidad_ma: [5, 1000],
  largo_m: [0.1, 1000],
  angulo_grados: [1, 360],
};

/** Claves que el Shop filtra y muestra pero que el buscador no lee de una consulta (no son `ClaveMedida`). */
export type ClaveSoloFaceta = "diametro_mm" | "ancho_mm";

/**
 * Rango válido de las claves sólo facetables. Espejo de `DEFINICION_ATRIBUTOS.rango` del CRM (lo hace cumplir
 * `db/__fixtures__/atributos-claves.json`, `rangos`). Va aparte de `RANGOS`: ése es el vocabulario del parser
 * de consultas y se compara uno a uno con `medidas-dorados.json`.
 */
export const RANGOS_SOLO_FACETA: Readonly<Record<ClaveSoloFaceta, readonly [number, number]>> = {
  diametro_mm: [5, 200],
  ancho_mm: [30, 1000],
};

/** Rango válido de cualquier clave numérica que el Shop sabe validar (medidas del buscador y sólo facetables). */
export function rangoDeClave(clave: string): readonly [number, number] | undefined {
  if (Object.hasOwn(RANGOS, clave)) return RANGOS[clave as ClaveMedida];
  if (Object.hasOwn(RANGOS_SOLO_FACETA, clave)) return RANGOS_SOLO_FACETA[clave as ClaveSoloFaceta];
  return undefined;
}

/**
 * Claves DISCRETAS cuyo orden es estricto: un producto que cumple la medida va SIEMPRE antes que uno cuyo dato la
 * contradice (con el dato de otro valor), y el que no tiene dato queda en el medio. Sólo ordena: nunca excluye.
 * Las blandas (potencia, temperatura, flujo...) quedan afuera: un valor cercano no es una contradicción.
 */
export const CLAVES_DISCRETAS: readonly ClaveMedida[] = ["polos", "corriente_a", "sensibilidad_ma", "zocalo"];

/**
 * Peso con que el plan marca una medida discreta de confianza alta para el orden estricto. Es el contrato entre
 * `aplicarMedidas` (emite) y `puntajeBusqueda` (ordena): una medida discreta con este peso o más (los de confianza
 * media o los ids de Jev quedan en 0,9 o menos) premia al que cumple y penaliza al que contradice.
 */
export const PESO_ORDEN_ESTRICTO = 1;

/** ¿El id es una medida discreta (valor exacto) del orden estricto? */
export function esMedidaDiscreta(id: string): boolean {
  const m = leerIdMedida(id);
  return m !== null && m.op === "eq" && (CLAVES_DISCRETAS as readonly string[]).includes(m.clave);
}

/** Claves cuyo valor es un entero. */
export const CLAVES_ENTERAS: readonly ClaveMedida[] = ["ip", "polos", "angulo_grados"];

/** Cada lado de `medidas_mm` (AxB[xC]), en milímetros. */
export const DIMENSION_MM: readonly [number, number] = [1, 9999];

export const ZOCALOS = [
  "e10",
  "e12",
  "e14",
  "e27",
  "e40",
  "gu10",
  "gu5.3",
  "mr11",
  "mr16",
  "gx53",
  "g4",
  "g9",
  "g13",
  "g24",
  "r7s",
] as const;
export const CURVAS = ["b", "c", "d"] as const;

/** Corrientes nominales normalizadas (serie IEC): las únicas que se aceptan en `NxM` de protección. */
export const SERIE_IEC: readonly number[] = [1, 2, 3, 4, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125];

// ---------------------------------------------------------------------------------------------
// Gramática cerrada de ids
// ---------------------------------------------------------------------------------------------

/** Largo máximo de un id completo (`clave:valor`). */
export const MAX_LARGO_ID = 40;

export type GrupoMedida = `medida:${ClaveMedida}`;
export const grupoDeMedida = (clave: ClaveMedida): GrupoMedida => `medida:${clave}`;

/** Cómo es el valor de una clave y qué formas de id admite. */
export interface EspecificacionMedida {
  /** num = número; ip = entero con semántica "o superior"; texto = vocabulario cerrado; dim = AxB[xC]. */
  forma: "num" | "ip" | "texto" | "dim";
  rango?: readonly [number, number];
  entero: boolean;
  /** Enumeración de las claves de texto. */
  valores?: readonly string[];
  /** `eq` = `clave:valor`; `banda` = `clave:a-b`. */
  ops: readonly ("eq" | "banda")[];
  unidad: string | null;
  etiqueta: string;
}

const num = (clave: ClaveMedida, unidad: string | null, etiqueta: string, banda = true): EspecificacionMedida => ({
  forma: "num",
  rango: RANGOS[clave],
  entero: (CLAVES_ENTERAS as readonly string[]).includes(clave),
  ops: banda ? ["eq", "banda"] : ["eq"],
  unidad,
  etiqueta,
});

/** Especificación de cada clave. El rango sale de `RANGOS` (espejo del CRM, ver el fixture). */
export const ESPECIFICACION: Readonly<Record<ClaveMedida, EspecificacionMedida>> = {
  potencia_w: num("potencia_w", "W", "Potencia"),
  temperatura_k: num("temperatura_k", "K", "Temperatura de color"),
  ip: { forma: "ip", rango: RANGOS.ip, entero: true, ops: ["eq"], unidad: null, etiqueta: "Protección" },
  flujo_lm: num("flujo_lm", "lm", "Flujo luminoso"),
  tension_v: num("tension_v", "V", "Tensión"),
  zocalo: { forma: "texto", entero: false, valores: ZOCALOS, ops: ["eq"], unidad: null, etiqueta: "Zócalo" },
  corriente_a: num("corriente_a", "A", "Corriente"),
  polos: num("polos", null, "Polos", false),
  seccion_mm2: num("seccion_mm2", "mm²", "Sección"),
  medidas_mm: { forma: "dim", entero: false, ops: ["eq"], unidad: "mm", etiqueta: "Medidas" },
  poder_corte_ka: num("poder_corte_ka", "kA", "Poder de corte"),
  curva: { forma: "texto", entero: false, valores: CURVAS, ops: ["eq"], unidad: null, etiqueta: "Curva" },
  sensibilidad_ma: num("sensibilidad_ma", "mA", "Sensibilidad"),
  largo_m: num("largo_m", "m", "Largo"),
  angulo_grados: num("angulo_grados", "°", "Ángulo"),
};

/** Un id leído: `eq` (valor) o `entre` (banda `a-b`). `ip:NN` es `eq` y significa "NN o superior". */
export interface MedidaId {
  clave: ClaveMedida;
  op: "eq" | "entre";
  valor?: number | string;
  min?: number;
  max?: number;
}

/** Entrada de `idDeMedida`: estructural, para aceptar lo que devuelve el parser sin importarlo. */
export interface EntradaMedida {
  clave: string;
  op: string;
  valor?: number | string;
  min?: number;
  max?: number;
}

/** Forma cerrada de entrada: clave de 2 a 20 minúsculas, dígitos o guion bajo ("ip", "seccion_mm2"), un ":" y un valor corto. */
const RE_ID = /^([a-z][a-z0-9_]{1,19}):([a-z0-9.-]{1,16})$/;
/** Número canónico: sin ceros a la izquierda, sin signo, sin exponente, hasta 2 decimales. */
const RE_NUMERO = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/;
const RE_DIM = /^[1-9]\d{0,3}(?:x[1-9]\d{0,3}){1,2}$/;

/** Número canónico del texto, o null (se re-serializa y tiene que dar lo mismo). */
export function numeroCanonico(texto: string): number | null {
  if (!RE_NUMERO.test(texto)) return null;
  const n = Number(texto);
  return Number.isFinite(n) && String(n) === texto ? n : null;
}

function numeroValido(esp: EspecificacionMedida, n: number | null): n is number {
  if (n === null) return false;
  if (esp.rango && (n < esp.rango[0] || n > esp.rango[1])) return false;
  return !esp.entero || Number.isInteger(n);
}

/**
 * Lee un id dinámico. null si no cumple la gramática cerrada (forma, canonicidad, rango, vocabulario,
 * largo). El valor NUNCA se interpreta como texto libre: o es un número canónico, o un elemento de
 * una enumeración, o una dimensión `AxB[xC]`.
 */
export function leerIdMedida(id: string): MedidaId | null {
  if (typeof id !== "string" || id.length > MAX_LARGO_ID) return null;
  const partes = RE_ID.exec(id);
  if (!partes) return null;
  const [, clave, valor] = partes;
  if (!esClaveMedida(clave)) return null;
  const esp = ESPECIFICACION[clave];

  if (esp.forma === "texto") return esp.valores!.includes(valor) ? { clave, op: "eq", valor } : null;
  if (esp.forma === "dim") {
    if (!RE_DIM.test(valor)) return null;
    return valor.split("x").every((d) => Number(d) >= DIMENSION_MM[0] && Number(d) <= DIMENSION_MM[1]) ? { clave, op: "eq", valor } : null;
  }

  const trozos = valor.split("-");
  if (trozos.length === 1) {
    const n = numeroCanonico(valor);
    return numeroValido(esp, n) ? { clave, op: "eq", valor: n } : null;
  }
  if (trozos.length === 2 && esp.ops.includes("banda")) {
    const a = numeroCanonico(trozos[0]);
    const b = numeroCanonico(trozos[1]);
    return numeroValido(esp, a) && numeroValido(esp, b) && a < b ? { clave, op: "entre", min: a, max: b } : null;
  }
  return null;
}

export const esMedidaId = (id: string): boolean => leerIdMedida(id) !== null;

/**
 * Id canónico de una medida: `eq` ⇒ `clave:valor`; `entre` ⇒ banda `clave:a-b`. `lte`/`gte` no tienen id
 * (solo el rango de potencia, en un cambio aparte). null si lo armado no pasa la gramática: el id que
 * sale de acá siempre vuelve igual por `leerIdMedida`.
 */
export function idDeMedida(m: EntradaMedida): string | null {
  if (!m || !esClaveMedida(m.clave)) return null;
  let valor: string | null = null;
  if (m.op === "eq" && (typeof m.valor === "string" || typeof m.valor === "number")) valor = String(m.valor);
  else if (m.op === "entre" && typeof m.min === "number" && typeof m.max === "number") valor = `${m.min}-${m.max}`;
  if (valor === null) return null;
  // Un número que el parser leyó como texto ("20") no es el mismo valor que 20: se exige el tipo.
  if (m.op === "eq" && typeof m.valor === "string" && ESPECIFICACION[m.clave].forma !== "texto" && ESPECIFICACION[m.clave].forma !== "dim") return null;
  const id = `${m.clave}:${valor}`;
  return leerIdMedida(id) ? id : null;
}

// ---------------------------------------------------------------------------------------------
// Criterio estructurado, patrón y etiqueta
// ---------------------------------------------------------------------------------------------

/**
 * Qué valor de `catalog_atributos` cumple la medida (mismo tipo que usa el diccionario):
 * eq numérica ⇒ `numeros`; tensión y corriente ⇒ también `enRango` (un "85-265" cumple 110; un relé térmico
 * o un guardamotor de regulación "4-6" cumple 5 A, aunque su `valor_num` sea el tope); ip ⇒ `desde`
 * (IP NN o superior); zócalo, curva y medidas ⇒ `textos`; banda ⇒ `desde`/`hasta`.
 */
export function criterioDeMedida(m: MedidaId): CriterioEstructurado {
  if (m.op === "entre") return { clave: m.clave, desde: m.min, hasta: m.max };
  if (typeof m.valor === "string") return { clave: m.clave, textos: [m.valor] };
  if (m.clave === "ip") return { clave: m.clave, desde: m.valor };
  if (m.clave === "tension_v" || m.clave === "corriente_a") return { clave: m.clave, numeros: [m.valor!], enRango: m.valor };
  return { clave: m.clave, numeros: [m.valor!] };
}

/** Inicio y fin de palabra sobre texto normalizado (mismos que el diccionario). */
const INI = "(^|[^a-z0-9])";
const FIN = "([^a-z0-9]|$)";
/** Borde izquierdo de un número: nada numérico ni separador decimal pegado antes ("112v", "9,5w"). */
const NUMINI = "(^|[^0-9.,])";

/** Número del patrón: el punto decimal admite también coma ("9.5" ⇒ `9[.,]5`). */
const numeroPatron = (n: number) => String(n).replace(".", "[.,]");

/**
 * Regex (subconjunto común de JS y Postgres ARE) sobre nombre + descripción normalizados para
 * detectar la medida en el texto. undefined cuando el texto no la distingue: polos, curva, bandas y
 * medidas_mm. Para `ip` acepta el pedido y todo lo superior (IP NN … IP 69).
 */
export function patronDeMedida(m: MedidaId): string | undefined {
  if (m.op !== "eq") return undefined;
  const v = m.valor;
  if (typeof v === "string") {
    if (m.clave !== "zocalo") return undefined;
    const letras = /^[a-z]+/.exec(v)![0];
    const resto = v.slice(letras.length).replace(".", "[.,]");
    return `${INI}${letras}[- ]?${resto}([^0-9]|$)`;
  }
  if (v === undefined) return undefined;
  const n = numeroPatron(v);
  switch (m.clave) {
    case "corriente_a":
      return `${NUMINI}${n} ?(a|amp|amps|amper|amperes?|amperios?)${FIN}`;
    case "potencia_w":
      return `${NUMINI}${n} ?(w|watts?)${FIN}`;
    case "tension_v":
      return `${NUMINI}${n} ?(v|vcc|vdc|vac|volt)`;
    case "sensibilidad_ma":
      return `${NUMINI}${n} ?ma${FIN}`;
    case "flujo_lm":
      return `${NUMINI}${n} ?(lm|lumenes?)${FIN}`;
    case "seccion_mm2":
      return `${NUMINI}${n} ?(mm2|mm²)${FIN}`;
    case "poder_corte_ka":
      return `${NUMINI}${n} ?ka${FIN}`;
    case "temperatura_k":
      return `(^|[^0-9])(${v}) ?°?k${FIN}`;
    case "largo_m":
      return `${NUMINI}${n} ?(m|mt|mts|metros?)${FIN}`;
    case "angulo_grados":
      return `${NUMINI}${n} ?(°|grados?)${FIN}`;
    case "ip": {
      const superiores: number[] = [];
      for (let ip = v; ip <= 69; ip++) superiores.push(ip);
      return `${INI}ip ?-?(${superiores.join("|")})${FIN}`;
    }
    default:
      return undefined;
  }
}

/** Número legible en es-AR: coma decimal, sin separador de miles ("9,5", "1200"). */
const aTexto = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2, useGrouping: false });

/** Etiqueta del chip: "Corriente: 20 A", "Polos: 2", "Potencia: 8 a 10 W", "Zócalo: E14", "IP54 o superior". */
export function formatoEtiqueta(m: MedidaId): string {
  const esp = ESPECIFICACION[m.clave];
  if (m.clave === "ip") return `IP${m.valor} o superior`;
  let valor: string;
  if (m.op === "entre") valor = `${aTexto(m.min!)} a ${aTexto(m.max!)}`;
  else if (typeof m.valor === "string") {
    valor = m.clave === "medidas_mm" ? m.valor.split("x").join(" x ") : m.valor.toUpperCase();
  } else valor = aTexto(m.valor!);
  const unidad = esp.unidad ? (esp.unidad === "°" ? "°" : ` ${esp.unidad}`) : "";
  return `${esp.etiqueta}: ${valor}${unidad}`;
}
