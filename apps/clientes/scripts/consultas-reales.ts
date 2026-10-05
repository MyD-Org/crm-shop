/**
 * Lógica PURA de la extracción de consultas reales (slice B de la línea base de
 * búsqueda): filtrado de datos personales, muestreo top-N + cola larga
 * reproducible y reporte de población. Sin base de datos ni sistema de archivos:
 * el CLI (`extraer-consultas-reales.ts`) es el que lee y escribe.
 *
 * Privacidad (repo público): el texto de una consulta sólo existe en las
 * funciones que arman el ARCHIVO local (`armarArchivo`). El resumen y el texto
 * de consola (`resumirPoblacion`, `formatearResumen`, `textoConsola`) son
 * agregados: números y porcentajes, nunca una consulta.
 */
import { pareceDatoPersonal, LARGO_MAX_CONSULTA } from "@/lib/busqueda-inteligente/normalizar";
import { percentil } from "@/lib/busqueda-v2/__banco__/metricas";

/** Una consulta normalizada con sus usos, agregada entre todos los `arbol_hash`. */
export interface ConsultaAgregada {
  consulta: string;
  /** Suma de `hits` de todas las filas de la consulta (usos vía /buscar, no usuarios únicos). */
  hits: number;
  /** Primera creación (ISO), si se conoce. */
  primera: string | null;
  /** Último uso (ISO), si se conoce. */
  ultima: string | null;
  /** `jev` | `deterministico` de cada fila de la consulta. */
  fuentes: string[];
  /** Intención del plan cacheado (`producto|necesidad|pregunta|codigo`), si la hay. */
  intencion: string | null;
}

/** Fila cruda del SELECT agregado del CLI (los tipos dependen del driver: se normalizan acá). */
export interface FilaAgregada {
  consulta: string;
  hits: number | string;
  primera: string | Date | null;
  ultima: string | Date | null;
  /** `string_agg(distinct fuente, ',')`. */
  fuentes: string | null;
  intencion: string | null;
}

const aIso = (v: string | Date | null): string | null => {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

export function desdeFila(f: FilaAgregada): ConsultaAgregada {
  return {
    consulta: f.consulta,
    hits: Number(f.hits),
    primera: aIso(f.primera),
    ultima: aIso(f.ultima),
    fuentes: f.fuentes ? f.fuentes.split(",").map((x) => x.trim()).filter(Boolean).sort() : [],
    intencion: f.intencion,
  };
}

export interface Excluidas {
  datoPersonal: number;
  vacia: number;
  larga: number;
}

/** Defensa en profundidad: la tabla ya descarta datos personales al guardar, se vuelve a aplicar el mismo criterio. */
export function filtrarPersonales(consultas: readonly ConsultaAgregada[]): { validas: ConsultaAgregada[]; excluidas: Excluidas } {
  const excluidas: Excluidas = { datoPersonal: 0, vacia: 0, larga: 0 };
  const validas: ConsultaAgregada[] = [];
  for (const c of consultas) {
    if (!c.consulta.trim()) excluidas.vacia++;
    else if (c.consulta.length > LARGO_MAX_CONSULTA) excluidas.larga++;
    else if (pareceDatoPersonal(c.consulta)) excluidas.datoPersonal++;
    else validas.push(c);
  }
  return { validas, excluidas };
}

/** Más usadas primero; desempate por texto: el orden no depende de cómo llegue la lista. */
const porHits = (a: ConsultaAgregada, b: ConsultaAgregada) => b.hits - a.hits || (a.consulta < b.consulta ? -1 : a.consulta > b.consulta ? 1 : 0);

/** PRNG sembrado (mulberry32): misma semilla => misma secuencia en cualquier máquina. */
function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OpcionesMuestreo {
  top: number;
  cola: number;
  semilla: number;
}

export interface Muestra {
  /** Top-N por hits (más usadas primero) y luego la cola muestreada (también por hits). */
  seleccion: ConsultaAgregada[];
  semilla: number;
  /** Total de consultas distintas de las que se muestreó. */
  nTotal: number;
  nTop: number;
  nCola: number;
  /** Tope pedido de cada parte (lo declara el archivo). */
  pedido: { top: number; cola: number };
}

/** Top-N por hits + una muestra aleatoria sembrada del resto (la cola larga). Población chica: entra todo y la cola queda vacía. */
export function muestrear(consultas: readonly ConsultaAgregada[], { top, cola, semilla }: OpcionesMuestreo): Muestra {
  const orden = [...consultas].sort(porHits);
  const cabeza = orden.slice(0, Math.max(0, top));
  const resto = orden.slice(cabeza.length);
  // Fisher–Yates parcial: sólo se sortean las `n` posiciones que se necesitan.
  const n = Math.min(Math.max(0, cola), resto.length);
  const azar = prng(semilla);
  const pool = [...resto];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(azar() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const colaElegida = pool.slice(0, n).sort(porHits);
  return {
    seleccion: [...cabeza, ...colaElegida],
    semilla,
    nTotal: orden.length,
    nTop: cabeza.length,
    nCola: colaElegida.length,
    pedido: { top, cola },
  };
}

export const TEXTO_SESGO =
  "Sesgo de población: sólo hay consultas hechas por /buscar con la búsqueda con IA prendida. No incluye las búsquedas clásicas, el autocompletado, el chat ni los códigos de producto. Los usos (hits) no son usuarios únicos.";

const INTENCIONES = ["producto", "necesidad", "pregunta", "codigo"] as const;
const MINIMO_RECOMENDADO = 100;

type ClaveIntencion = (typeof INTENCIONES)[number] | "otra" | "sin_dato";

interface Cuenta {
  n: number;
  pct: number;
}

export interface ResumenPoblacion {
  distintas: number;
  totalHits: number;
  /** % de los hits que concentran las 10 / 50 consultas más usadas. */
  pctHitsTop10: number;
  pctHitsTop50: number;
  /** Consultas con un solo hit. */
  unHit: Cuenta;
  /** `jev` si alguna fila de la consulta salió de Jev; si no, `deterministico` (suma 100 %). */
  fuentes: { jev: Cuenta; deterministico: Cuenta };
  intenciones: Record<ClaveIntencion, Cuenta>;
  longitud: {
    caracteres: { min: number; p50: number; p95: number; max: number };
    palabras: Record<"1" | "2" | "3" | "4+", number>;
  };
  fechas: { desde: string | null; hasta: string | null };
  /** Siempre 1: la extracción es de un solo tenant. */
  tenants: 1;
  excluidas: Excluidas;
  /** El conteo de resultados no está en el plan cacheado: se mide corriendo el banco real. */
  zeroResult: { disponible: false; motivo: string };
  avisos: string[];
}

const pct = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);
const cuenta = (n: number, total: number): Cuenta => ({ n, pct: pct(n, total) });

/** Agregados de la población (consultas YA filtradas). Ningún campo contiene texto de una consulta. */
export function resumirPoblacion(consultas: readonly ConsultaAgregada[], excluidas: Excluidas): ResumenPoblacion {
  const n = consultas.length;
  const orden = [...consultas].sort(porHits);
  const totalHits = orden.reduce((s, c) => s + c.hits, 0);
  const hitsTop = (k: number) => pct(orden.slice(0, k).reduce((s, c) => s + c.hits, 0), totalHits);

  const jev = consultas.filter((c) => c.fuentes.includes("jev")).length;

  const porIntencion: Record<ClaveIntencion, number> = { producto: 0, necesidad: 0, pregunta: 0, codigo: 0, otra: 0, sin_dato: 0 };
  for (const c of consultas) {
    const k: ClaveIntencion = c.intencion == null ? "sin_dato" : (INTENCIONES as readonly string[]).includes(c.intencion) ? (c.intencion as ClaveIntencion) : "otra";
    porIntencion[k]++;
  }

  const largos = consultas.map((c) => c.consulta.length);
  const palabras = { "1": 0, "2": 0, "3": 0, "4+": 0 };
  for (const c of consultas) {
    const w = c.consulta.trim().split(/\s+/).filter(Boolean).length;
    palabras[w >= 4 ? "4+" : (String(Math.max(1, w)) as "1" | "2" | "3")]++;
  }

  const fechas = (campo: "primera" | "ultima") =>
    consultas.map((c) => c[campo]).filter((f): f is string => !!f && !Number.isNaN(Date.parse(f))).sort((a, b) => Date.parse(a) - Date.parse(b));
  const primeras = fechas("primera");
  const ultimas = fechas("ultima");

  const avisos: string[] = [];
  if (n < MINIMO_RECOMENDADO) {
    avisos.push(
      `Hay menos de ${MINIMO_RECOMENDADO} consultas distintas (${n}): el banco real va a ser chico. Ajuste top/cola y complemente con casos sintéticos.`,
    );
  }

  return {
    distintas: n,
    totalHits,
    pctHitsTop10: hitsTop(10),
    pctHitsTop50: hitsTop(50),
    unHit: cuenta(consultas.filter((c) => c.hits <= 1).length, n),
    fuentes: { jev: cuenta(jev, n), deterministico: cuenta(n - jev, n) },
    intenciones: Object.fromEntries(Object.entries(porIntencion).map(([k, v]) => [k, cuenta(v, n)])) as ResumenPoblacion["intenciones"],
    longitud: {
      caracteres: { min: largos.length ? Math.min(...largos) : 0, p50: percentil(largos, 50), p95: percentil(largos, 95), max: largos.length ? Math.max(...largos) : 0 },
      palabras,
    },
    fechas: { desde: primeras[0] ?? null, hasta: ultimas[ultimas.length - 1] ?? null },
    tenants: 1,
    excluidas,
    zeroResult: {
      disponible: false,
      motivo:
        "el plan cacheado (resultado) no guarda la cantidad de productos devueltos; el zero-result real sale de correr el banco real (ponderado por hits), no de la telemetría",
    },
    avisos,
  };
}

const f1 = (x: number) => x.toFixed(1);

/** Reporte de población en texto. Sólo agregados: lo puede ver un agente y pegarse en un PR. */
export function formatearResumen(r: ResumenPoblacion): string {
  const l = (s: string) => `  ${s}`;
  return [
    "Población de consultas reales",
    l(`consultas distintas: ${r.distintas} | usos totales (hits): ${r.totalHits} | tenants: ${r.tenants}`),
    l(`concentración: top 10 = ${f1(r.pctHitsTop10)} % de los hits, top 50 = ${f1(r.pctHitsTop50)} %; con 1 solo hit: ${r.unHit.n} (${f1(r.unHit.pct)} %)`),
    l(`fuente (por consulta): jev ${f1(r.fuentes.jev.pct)} % (${r.fuentes.jev.n}) | determinístico ${f1(r.fuentes.deterministico.pct)} % (${r.fuentes.deterministico.n})`),
    l(
      `intención: ${Object.entries(r.intenciones)
        .filter(([, v]) => v.n > 0)
        .map(([k, v]) => `${k} ${f1(v.pct)} %`)
        .join(" | ") || "sin datos"}`,
    ),
    l(`largo (caracteres): min ${r.longitud.caracteres.min}, p50 ${r.longitud.caracteres.p50}, p95 ${r.longitud.caracteres.p95}, max ${r.longitud.caracteres.max}`),
    l(`palabras: 1 = ${r.longitud.palabras["1"]}, 2 = ${r.longitud.palabras["2"]}, 3 = ${r.longitud.palabras["3"]}, 4 o más = ${r.longitud.palabras["4+"]}`),
    l(`fechas: ${r.fechas.desde ?? "s/d"} a ${r.fechas.hasta ?? "s/d"}`),
    l(`excluidas: ${r.excluidas.datoPersonal} por dato personal, ${r.excluidas.vacia} vacías, ${r.excluidas.larga} de más de ${LARGO_MAX_CONSULTA} caracteres`),
    l(`zero-result real: no disponible (${r.zeroResult.motivo})`),
    ...r.avisos.map((a) => `AVISO: ${a}`),
    TEXTO_SESGO,
  ].join("\n");
}

export interface DatosArchivo {
  extraidoEl: string;
  /** Nombres de las categorías del árbol vivo: el vocabulario para etiquetar. */
  categorias: string[];
  muestra: Muestra;
  resumen: ResumenPoblacion;
}

export interface ArchivoConsultas {
  esquema: 1;
  extraidoEl: string;
  muestreo: { top: number; cola: number; semilla: number; nTotal: number };
  categorias: string[];
  resumen: ResumenPoblacion;
  /** ÚNICO lugar con texto de consultas reales: archivo local ignorado por git. */
  consultas: ConsultaAgregada[];
}

/** Contenido del archivo local (`tmp/busqueda/consultas-reales.local.json`). Sin entorno ni identificador de tenant. */
export function armarArchivo({ extraidoEl, categorias, muestra, resumen }: DatosArchivo): ArchivoConsultas {
  return {
    esquema: 1,
    extraidoEl,
    muestreo: { top: muestra.pedido.top, cola: muestra.pedido.cola, semilla: muestra.semilla, nTotal: muestra.nTotal },
    categorias,
    resumen,
    consultas: muestra.seleccion,
  };
}

/** Lo único que imprime el CLI: conteos, ruta, duración y el resumen agregado. Nunca consultas. */
export function textoConsola(o: { resumen: ResumenPoblacion; muestra: Muestra; ruta: string; ms: number }): string {
  const dur = o.ms >= 1000 ? `${(o.ms / 1000).toFixed(1)} s` : `${o.ms} ms`;
  return [
    formatearResumen(o.resumen),
    "",
    `Conjunto de trabajo: ${o.muestra.seleccion.length} consultas (top ${o.muestra.nTop} + cola ${o.muestra.nCola}, semilla ${o.muestra.semilla}, de ${o.muestra.nTotal} distintas).`,
    `Archivo local (ignorado por git): ${o.ruta}`,
    `Duración: ${dur}`,
  ].join("\n");
}

export interface ArgsExtraccion {
  top: number;
  cola: number;
  semilla: number;
  salida: string;
  /** Imprime las consultas del conjunto de trabajo en la consola (sólo uso local). */
  verConsultas: boolean;
}

const FLAGS_EXTRACCION = ["top", "cola", "semilla", "salida", "ver-consultas"];

/** Argumentos del CLI de extracción. Lanza ante un valor inválido o un flag desconocido (antes de abrir ninguna conexión). */
export function parsearArgsExtraccion(argv: readonly string[]): ArgsExtraccion {
  const mapa = new Map<string, string>();
  for (const a of argv) {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    mapa.set(k, v.join("=") || "1");
  }
  for (const k of mapa.keys()) {
    if (!FLAGS_EXTRACCION.includes(k)) throw new Error(`Flag desconocido: --${k}. Válidos: ${FLAGS_EXTRACCION.map((f) => `--${f}`).join(", ")}.`);
  }
  const entero = (nombre: string, def: number, min: number) => {
    const v = mapa.get(nombre);
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) throw new Error(`--${nombre} debe ser un entero >= ${min}.`);
    return n;
  };
  return {
    top: entero("top", 150, 0),
    cola: entero("cola", 50, 0),
    semilla: entero("semilla", 1, 0),
    salida: mapa.get("salida") ?? "tmp/busqueda/consultas-reales.local.json",
    verConsultas: mapa.has("ver-consultas"),
  };
}

/**
 * Mensaje de error apto para consola: el de las variables faltantes (propio,
 * sin valores) pasa; cualquier otro (los del driver pueden citar la cadena de
 * conexión o el usuario) se reduce al tipo y al código.
 */
export function mensajeSeguro(err: unknown): string {
  if (!(err instanceof Error)) return "error desconocido";
  if (/^Falta [A-Z_]+ en el entorno/.test(err.message)) return err.message;
  const codigo = (err as { code?: unknown }).code;
  return `${err.name}${typeof codigo === "string" ? ` (${codigo})` : ""}: no se muestra el detalle para no exponer la conexión`;
}
