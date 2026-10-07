/**
 * Facetas por tipo de producto (change `catalogo-filtros-ux`, flag `catalogo-facetas-por-tipo`).
 *
 * Módulo puro, sin IO. Dos piezas:
 *  - `REGISTRO`: qué claves estructuradas (`catalog_atributos`) se pueden ofrecer como filtro, con su
 *    título, unidad, control (lista de valores o rango), orden y umbrales. Una clave que no está acá
 *    NUNCA se ofrece (medidas_mm, leds_*, potencia_w_m...). diametro_mm, ancho_mm (migración 0070 del CRM), modulos y dimerizable (0072) sí.
 *  - `elegirFacetas`: dada la distribución de valores del conjunto que se está viendo, decide QUÉ
 *    claves mostrar (cobertura suficiente, más de un valor, tope de grupos) y con qué valores.
 *
 * El conteo y los denominadores los calcula la consulta (catalogo-facetas-sql.ts); acá solo se decide.
 * Umbrales: 30 % de cobertura (calibrado en P3), 2 valores y 6 grupos.
 */
import { ESPECIFICACION, CURVAS, ZOCALOS, CLAVES_ENTERAS, numeroCanonico, rangoDeClave, type ClaveMedida } from "./catalogo-atributos-medida";
import { normalizarTexto } from "./catalogo-atributos";
import { TIPO, type ClaveEstructurada } from "./catalogo-caracteristicas";

export interface ClaveFacetable {
  clave: ClaveEstructurada;
  titulo: string;
  unidad?: string;
  control: "lista" | "rango";
  /** Orden de aparición en el panel (menor = primero). Único en el registro. */
  orden: number;
  /** Cobertura mínima sobre el conjunto (sin el filtro de la propia clave). Default `UMBRAL_COBERTURA`. */
  umbral?: number;
  /** Valores distintos mínimos para ofrecer una lista. Default 2. */
  minValores?: number;
  /** Etiqueta de cada valor (la enumeración, en orden de aparición). Sin mapa se capitaliza el valor. */
  valores?: Readonly<Record<string, string>>;
  /** Rango con parámetros propios en la URL (la potencia usa `potencia_min`/`potencia_max`, no `?car=`). */
  param?: "potencia";
  grupo: "electricas" | "iluminacion" | "fisicas";
}

/**
 * Calibrado en P3 con la cobertura real (2026-10-06): con 40 % quedaban afuera claves útiles con datos
 * a medio cargar (corriente en llaves y tomas ~33 %, flujo en paneles ~36 %, temperatura en tiras ~38 %)
 * y las búsquedas mezcladas ("termica 2x20": ~32 % con dato) se quedaban sin ningún grupo. Con 30 % no se
 * suma ruido: el mínimo de 2 valores sigue descartando las claves de un solo valor.
 */
export const UMBRAL_COBERTURA = 0.3;
export const MIN_VALORES = 2;
/** Tope de grupos por tipo que se muestran a la vez. */
export const TOPE_GRUPOS = 6;
/** Valor de lista que viaja en la URL: corto y sin nada que no sea minúscula, dígito, punto, guion o guion bajo. */
export const RE_VALOR_CAR = /^[a-z0-9._-]{1,24}$/;

const mayuscula = (s: string) => s.toUpperCase();
const mapa = (valores: readonly string[], etiqueta: (v: string) => string) => Object.fromEntries(valores.map((v) => [v, etiqueta(v)]));

const TONOS: Record<string, string> = {
  calido: "Cálido",
  neutro: "Neutro",
  frio: "Frío",
  rojo: "Rojo",
  verde: "Verde",
  azul: "Azul",
  amarillo: "Amarillo",
  naranja: "Naranja",
  ambar: "Ámbar",
  violeta: "Violeta",
  rosa: "Rosa",
  rgb: "RGB",
  rgbw: "RGBW",
};

const COLORES: Record<string, string> = {
  blanco: "Blanco",
  negro: "Negro",
  gris: "Gris",
  rojo: "Rojo",
  azul: "Azul",
  verde: "Verde",
  amarillo: "Amarillo",
  marron: "Marrón",
  naranja: "Naranja",
  transparente: "Transparente",
  plateado: "Plateado",
  dorado: "Dorado",
};

const MONTAJES: Record<string, string> = {
  embutir: "Embutir",
  aplicar: "Aplicar",
  colgante: "Colgante",
  riel: "Riel",
  din: "Riel DIN",
};

/** Título y unidad de una clave medida: salen de la especificación del buscador (una sola fuente). */
const deMedida = (clave: ClaveMedida) => ({ titulo: ESPECIFICACION[clave].etiqueta, ...(ESPECIFICACION[clave].unidad ? { unidad: ESPECIFICACION[clave].unidad! } : {}) });

/**
 * Claves facetables. El orden es provisorio y cruza categorías (el tope de 6 grupos se aplica sobre las
 * elegibles de cada conjunto): potencia y corriente primero, luego protección eléctrica, luz y físicas.
 */
export const REGISTRO: readonly ClaveFacetable[] = [
  { clave: "potencia_w", ...deMedida("potencia_w"), control: "rango", orden: 10, param: "potencia", grupo: "iluminacion" },
  { clave: "corriente_a", ...deMedida("corriente_a"), control: "lista", orden: 20, grupo: "electricas" },
  { clave: "polos", ...deMedida("polos"), control: "lista", orden: 30, grupo: "electricas" },
  { clave: "curva", ...deMedida("curva"), control: "lista", orden: 40, valores: mapa(CURVAS, mayuscula), grupo: "electricas" },
  { clave: "poder_corte_ka", ...deMedida("poder_corte_ka"), control: "lista", orden: 50, grupo: "electricas" },
  { clave: "sensibilidad_ma", ...deMedida("sensibilidad_ma"), control: "lista", orden: 60, grupo: "electricas" },
  { clave: "seccion_mm2", ...deMedida("seccion_mm2"), control: "lista", orden: 70, grupo: "fisicas" },
  // Caños, tubos y accesorios de caño (diámetro) y bandejas portacables (ancho): valores comerciales discretos, de ahí lista.
  { clave: "diametro_mm", titulo: "Diámetro", unidad: "mm", control: "lista", orden: 72, grupo: "fisicas" },
  { clave: "ancho_mm", titulo: "Ancho", unidad: "mm", control: "lista", orden: 74, grupo: "fisicas" },
  // Capacidad de gabinetes y cajas DIN (migración 0072 del CRM): "12 módulos" = 12 bocas = 12 polos.
  { clave: "modulos", titulo: "Módulos", unidad: "módulos", control: "lista", orden: 76, grupo: "fisicas" },
  { clave: "tension_v", ...deMedida("tension_v"), control: "lista", orden: 80, grupo: "electricas" },
  { clave: "zocalo", ...deMedida("zocalo"), control: "lista", orden: 90, valores: mapa(ZOCALOS, mayuscula), grupo: "iluminacion" },
  { clave: "temperatura_k", ...deMedida("temperatura_k"), control: "lista", orden: 100, grupo: "iluminacion" },
  { clave: "tono", titulo: "Tipo de luz", control: "lista", orden: 110, valores: TONOS, grupo: "iluminacion" },
  { clave: "flujo_lm", ...deMedida("flujo_lm"), control: "rango", orden: 120, grupo: "iluminacion" },
  { clave: "ip", ...deMedida("ip"), control: "lista", orden: 130, grupo: "fisicas" },
  { clave: "angulo_grados", ...deMedida("angulo_grados"), control: "lista", orden: 140, grupo: "iluminacion" },
  { clave: "largo_m", ...deMedida("largo_m"), control: "rango", orden: 150, grupo: "fisicas" },
  { clave: "color", titulo: "Color", control: "lista", orden: 160, valores: COLORES, grupo: "fisicas" },
  { clave: "montaje", titulo: "Montaje", control: "lista", orden: 170, valores: MONTAJES, grupo: "fisicas" },
  // Sí / No del producto (lámparas, paneles, tiras y drivers). Sin el dato no se ofrece: cobertura y 2 valores como el resto.
  { clave: "dimerizable", titulo: "Dimerizable", control: "lista", orden: 180, valores: { si: "Sí", no: "No" }, grupo: "iluminacion" },
];

const POR_CLAVE = new Map<string, ClaveFacetable>(REGISTRO.map((c) => [c.clave, c]));

/** La entrada del registro de una clave, o `undefined` si no es facetable. */
export function claveFacetable(clave: string): ClaveFacetable | undefined {
  return POR_CLAVE.get(clave);
}

export interface OverrideCategoria {
  /** Claves que no se ofrecen en esa categoría. */
  ocultar?: readonly ClaveEstructurada[];
  /** Orden que pisa al del registro para esa categoría. */
  orden?: Partial<Record<ClaveEstructurada, number>>;
}

/**
 * Ajustes por categoría, por NOMBRE de la categoría (sin tildes ni mayúsculas). Vacío a propósito: el
 * comportamiento por defecto sale de los datos. Se llena con lo que muestre el uso real (change
 * `catalogo-filtros-ux`, P6). Si el admin renombra una categoría el override deja de aplicar: no rompe.
 */
export const OVERRIDES: Readonly<Record<string, OverrideCategoria>> = {};

const formatoNumero = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2, useGrouping: false });
const capitalizar = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Etiqueta legible de un valor de lista: "20 A", "IP54", "E27", "Cálido". */
export function etiquetaValor(clave: string, valor: string): string {
  const def = claveFacetable(clave);
  if (clave === "ip") return `IP${valor}`;
  const propia = def?.valores?.[valor];
  if (propia) return propia;
  if (clave === "modulos" && valor === "1") return "1 módulo";
  if (TIPO[clave as ClaveEstructurada] === "num") {
    const n = Number(valor);
    if (!Number.isFinite(n)) return valor;
    const unidad = def?.unidad;
    return `${formatoNumero(n)}${unidad ? (unidad === "°" ? "°" : ` ${unidad}`) : ""}`;
  }
  return capitalizar(valor);
}

/**
 * ¿El valor de lista es válido para la clave? Forma cerrada (`RE_VALOR_CAR`); si la clave es numérica,
 * además número canónico dentro de su rango válido (y entero si corresponde).
 */
export function valorDeListaValido(clave: string, valor: string): boolean {
  if (!RE_VALOR_CAR.test(valor)) return false;
  if (TIPO[clave as ClaveEstructurada] !== "num") return true;
  const n = numeroCanonico(valor);
  if (n === null) return false;
  const rango = rangoDeClave(clave);
  if (rango && (n < rango[0] || n > rango[1])) return false;
  return !(CLAVES_ENTERAS as readonly string[]).includes(clave) || Number.isInteger(n);
}

export interface ValorFaceta {
  valor: string;
  etiqueta: string;
  count: number;
}

export type FacetaClave =
  | { clave: ClaveEstructurada; titulo: string; control: "lista"; items: ValorFaceta[] }
  | { clave: ClaveEstructurada; titulo: string; control: "rango"; unidad?: string; rango: { min: number; max: number }; param?: "potencia" };

export interface EntradaFacetas {
  /** Distribución de las claves de lista: cuántos productos tienen cada valor (conjunto sin el filtro de esa misma clave). */
  filas: readonly { clave: string; valor: string; n: number }[];
  /** Extremos y cantidad de productos con dato de cada clave de rango (idem). */
  rangos: readonly { clave: string; min: number; max: number; n: number }[];
  /** Por clave: cuántos productos tiene el conjunto sin el filtro de esa clave (denominador de la cobertura). */
  denominadores: Readonly<Record<string, number>>;
  /** Claves con un filtro `car` activo: se devuelven siempre. */
  activas: readonly string[];
  /** Nombre de la categoría tildada, para los overrides. */
  categoria?: string;
}

/** Orden de los valores de una lista: números de menor a mayor; texto en el orden del vocabulario y luego alfabético. */
function ordenDeValores(def: ClaveFacetable): (a: string, b: string) => number {
  if (TIPO[def.clave] === "num") return (a, b) => Number(a) - Number(b);
  const vocabulario = Object.keys(def.valores ?? {});
  const pos = (v: string) => {
    const i = vocabulario.indexOf(v);
    return i === -1 ? vocabulario.length : i;
  };
  return (a, b) => pos(a) - pos(b) || a.localeCompare(b);
}

function facetaDeLista(def: ClaveFacetable, e: EntradaFacetas, activa: boolean): FacetaClave | null {
  const porValor = new Map<string, number>();
  for (const f of e.filas) {
    if (f.clave !== def.clave || !(f.n > 0) || !valorDeListaValido(def.clave, f.valor)) continue;
    porValor.set(f.valor, (porValor.get(f.valor) ?? 0) + f.n);
  }
  const total = [...porValor.values()].reduce((s, n) => s + n, 0);
  const denominador = e.denominadores[def.clave] ?? 0;
  const elegible = denominador > 0 && total / denominador >= (def.umbral ?? UMBRAL_COBERTURA) && porValor.size >= (def.minValores ?? MIN_VALORES);
  if (!elegible && !activa) return null;
  const items = [...porValor.keys()].sort(ordenDeValores(def)).map((valor) => ({ valor, etiqueta: etiquetaValor(def.clave, valor), count: porValor.get(valor)! }));
  return { clave: def.clave, titulo: def.titulo, control: "lista", items };
}

function facetaDeRango(def: ClaveFacetable, e: EntradaFacetas, activa: boolean): FacetaClave | null {
  const valido = rangoDeClave(def.clave);
  // Los extremos que vienen de la consulta se acotan al rango válido: un valor suelto (un 250000 W) no estira el slider.
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (const r of e.rangos) {
    if (r.clave !== def.clave || !(r.n > 0) || !Number.isFinite(r.min) || !Number.isFinite(r.max)) continue;
    if (valido && (r.max < valido[0] || r.min > valido[1])) continue;
    min = Math.min(min, valido ? Math.max(r.min, valido[0]) : r.min);
    max = Math.max(max, valido ? Math.min(r.max, valido[1]) : r.max);
    n += r.n;
  }
  const hay = n > 0;
  const denominador = e.denominadores[def.clave] ?? 0;
  const elegible = hay && denominador > 0 && n / denominador >= (def.umbral ?? UMBRAL_COBERTURA) && min < max;
  if (!elegible && !activa) return null;
  // Con datos, extremos enteros (floor/ceil); sin datos (clave activa), el rango válido tal cual.
  const rango = hay ? { min: Math.floor(min), max: Math.ceil(max) } : { min: valido?.[0] ?? 0, max: valido?.[1] ?? 0 };
  return {
    clave: def.clave,
    titulo: def.titulo,
    control: "rango",
    ...(def.unidad ? { unidad: def.unidad } : {}),
    rango,
    ...(def.param ? { param: def.param } : {}),
  };
}

function overrideDe(categoria: string | undefined, overrides: Readonly<Record<string, OverrideCategoria>>): OverrideCategoria | undefined {
  if (!categoria) return undefined;
  const buscada = normalizarTexto(categoria).trim();
  for (const [nombre, ov] of Object.entries(overrides)) if (normalizarTexto(nombre).trim() === buscada) return ov;
  return undefined;
}

/**
 * Qué facetas por tipo ofrecer para un conjunto de productos. Una clave se ofrece si el registro la
 * conoce, su cobertura (sobre el conjunto SIN el filtro de esa misma clave) llega al umbral y tiene
 * más de un valor (lista) o `min < max` (rango). Se devuelven a lo sumo `TOPE_GRUPOS`, por `orden`; las
 * claves con filtro activo se devuelven siempre (aunque la categoría las oculte): hay que poder quitarlas.
 */
export function elegirFacetas(entrada: EntradaFacetas, overrides: Readonly<Record<string, OverrideCategoria>> = OVERRIDES): FacetaClave[] {
  const ov = overrideDe(entrada.categoria, overrides);
  const activas = new Set(entrada.activas);
  const candidatas: { faceta: FacetaClave; orden: number; activa: boolean }[] = [];
  for (const def of REGISTRO) {
    const activa = activas.has(def.clave);
    if (!activa && ov?.ocultar?.includes(def.clave)) continue;
    const faceta = def.control === "lista" ? facetaDeLista(def, entrada, activa) : facetaDeRango(def, entrada, activa);
    if (faceta) candidatas.push({ faceta, orden: ov?.orden?.[def.clave] ?? def.orden, activa });
  }
  const porOrden = (a: { orden: number }, b: { orden: number }) => a.orden - b.orden;
  const conFiltro = candidatas.filter((c) => c.activa);
  const libres = candidatas.filter((c) => !c.activa).sort(porOrden).slice(0, Math.max(0, TOPE_GRUPOS - conFiltro.length));
  return [...conFiltro, ...libres].sort(porOrden).map((c) => c.faceta);
}
