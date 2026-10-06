/**
 * Una corrida del banco de búsquedas: ejecuta cada caso con la tubería
 * elegida, evalúa y arma el `ReporteJson` (cabecera reproducible + métricas
 * por total y por corte + resultado por caso) y el texto de consola. El
 * ejecutor, el snapshot y el reloj se inyectan: el armado se prueba sin base
 * ni red. Módulo sin acceso a la base (el snapshot llega armado).
 *
 * Privacidad (repo público): un banco local o `privado` enmascara la consulta
 * como `#<idx>` en consola y JSON salvo `--ver-consultas`. Nunca se escribe
 * entorno, credenciales, cadenas de conexión ni el id real del tenant (la
 * cabecera lleva un alias).
 */
import { execFileSync } from "node:child_process";
import {
  evaluar,
  reporte,
  reporteAmpliado,
  resumir,
  type BusquedaBanco,
  type EvaluacionBusqueda,
  type ResultadoBanco,
} from "./banco";
import { cortarPor, resumenNumerico, type Latencia, type ResumenNum } from "./metricas";
import type { SnapshotCatalogo } from "./universo";
import type { VistaBanco } from "./vista";

export type Tuberia = "clasica" | "tolerante" | "fase1" | "v2" | "motor";
export type ModoJev = "grabado" | "vivo" | "no" | "cache" | "no aplica";

/** Política del motor de búsqueda (tubería `motor`): lo de hoy (`legado`) o la cascada. */
export type PoliticaBanco = "legado" | "cascada";
/** Superficie que mide la tubería `motor`. */
export type SuperficieBanco = "catalogo" | "autocompletar" | "chat";

/** Cuántos productos mira la evaluación (K) y si la superficie cuenta el total, por superficie. */
export interface DatosSuperficie {
  nombre: SuperficieBanco;
  k: number;
  conteo: boolean;
}

export const SUPERFICIES_BANCO: Record<SuperficieBanco, DatosSuperficie> = {
  catalogo: { nombre: "catalogo", k: 24, conteo: true },
  autocompletar: { nombre: "autocompletar", k: 8, conteo: false },
  chat: { nombre: "chat", k: 10, conteo: false },
};

export interface BancoDeCorrida {
  /** "versionado" o el nombre del archivo (nunca su contenido). */
  origen: string;
  /** Cargado con `--banco` (archivo local). */
  local: boolean;
  /** Marcado `privado` o de origen real. */
  privado: boolean;
  casos: BusquedaBanco[];
  hash: string;
  /** Casos revisados que entraron (banco real con etiquetas). */
  nRevisadas?: number;
}

export interface OpcionesCorrida {
  tuberia: Tuberia;
  jev: ModoJev;
  /** Modelo y fecha de grabado de Jev (sólo si aplica). */
  jevMeta?: { modelo: string | null; grabadoEl: string | null };
  vista: VistaBanco;
  /** `--produccion`: la cabecera dice "produccion" en vez de "banco". */
  produccion: boolean;
  banco: BancoDeCorrida;
  repeticiones: number;
  calentar: number;
  /** Valores de flags de Vercel declarados por la usuaria (no se leen). */
  flagsDeclarados: Record<string, string>;
  verConsultas: boolean;
  tenantAlias: string;
  umbral?: number;
  /** `--solo=...`: corrida parcial declarada en la cabecera. */
  parcial?: string;
  /** Sólo tubería `motor`: política y superficie que se miden (declaradas en la cabecera). */
  politica?: PoliticaBanco;
  superficie?: SuperficieBanco;
  /** `--ids`: escribir en el JSON los ids de lo devuelto por caso (paridad entre corridas; archivo local). */
  ids?: boolean;
  /** Estado del flag `busqueda-medidas` con que se corrió (lo declara quien arma la corrida); por defecto "no aplica". */
  busquedaMedidas?: "no aplica" | "on" | "off";
}

export interface DepsCorrida {
  arbol: { id: string; parentId: string | null; nombre: string }[];
  ejecutar: (q: string) => Promise<ResultadoBanco>;
  snapshot: SnapshotCatalogo;
  git?: () => { sha: string; sucio: boolean };
  ahora?: () => number;
  fecha?: () => Date;
  /** Jev grabado sin respuesta para ese caso (se excluye de las métricas, no se llama a Jev vivo). */
  sinGrabacion?: (c: BusquedaBanco) => boolean;
  /** Mensajes de aviso (por defecto, ninguno). Nunca recibe el texto de una consulta privada. */
  log?: (mensaje: string) => void;
}

export interface Cabecera {
  fecha: string;
  gitSha: string;
  sucio: boolean;
  tuberia: Tuberia;
  jev: { modo: ModoJev; modelo: string | null; grabadoEl: string | null };
  banco: { origen: string; n: number; hash: string; nRevisadas?: number };
  vista: { variante: "banco" | "produccion"; soloVisibles: boolean; soloStock: boolean };
  umbral?: number;
  flags: Record<string, string>;
  snapshot: SnapshotCatalogo;
  repeticiones: number;
  calentar: number;
  parcial?: string;
  /** Sólo tubería `motor`. */
  politica?: PoliticaBanco;
  superficie?: DatosSuperficie;
  tenantAlias: string;
  duracionMs: number;
  /** Estado de `busqueda-medidas` ("no aplica" hasta que la tubería v2 lo use). Ausente en snapshots anteriores. */
  busquedaMedidas?: string;
}

export interface CasoJson {
  idx: number;
  /** Ausente en bancos privados/locales (salvo `--ver-consultas`). */
  q?: string;
  tipo: string;
  perfil: string;
  posicion: number | null;
  rr: number | null;
  precision: number | null;
  total: number;
  ms?: number;
  top24Ok: boolean | null;
  intencionOk: boolean | null;
  categoriaOk: boolean | null;
  atributosOk: boolean | null;
  zero: boolean;
  sinGrabacion?: boolean;
  /** Tubería `motor`: etapa que resolvió (agregable, sin datos del caso). */
  etapa?: string;
  /** `--ids`: ids de lo devuelto, en orden. Nunca van a consola. */
  ids?: string[];
}

export interface ReporteJson {
  esquema: 1;
  cabecera: Cabecera;
  resumen: ResumenNum;
  cortes: { perfil: Record<string, ResumenNum>; intencion: Record<string, ResumenNum>; tipo: Record<string, ResumenNum> };
  latencia: Latencia;
  excluidos: { sinGrabacion: number };
  casos: CasoJson[];
  /** Sólo con `--jev=cache`: consultas sin plan cacheado (cayeron al determinista). */
  sinPlanCacheado?: number;
  /** Tubería `motor`: cuántos casos resolvió cada etapa (sólo agregados). */
  etapas?: Record<string, number>;
}

export interface ResultadoCorrida {
  json: ReporteJson;
  /** Texto de consola (tabla de siempre + métricas ampliadas), con la consulta enmascarada si corresponde. */
  texto: string;
  /** Evaluaciones que entraron a las métricas (con la consulta ya enmascarada si corresponde). */
  evaluaciones: EvaluacionBusqueda[];
  conIntencion: boolean;
  /** Puntaje 0..100 de siempre (para el umbral de salida). */
  puntaje: number;
}

const vacio = (): ResultadoBanco => ({ categoriasDuras: [], categoriasBlandas: [], atributosDuros: [], expansiones: [], productos: [], total: 0 });

/** Sha corto y si el árbol está sucio. Fuera de un repo git: "desconocido". */
export function gitInfo(): { sha: string; sucio: boolean } {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const sucio = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
    return { sha, sucio };
  } catch {
    return { sha: "desconocido", sucio: false };
  }
}

export async function correr(o: OpcionesCorrida, deps: DepsCorrida): Promise<ResultadoCorrida> {
  const ahora = deps.ahora ?? Date.now;
  const inicio = ahora();
  const { casos } = o.banco;
  const enmascarar = (o.banco.privado || o.banco.local) && !o.verConsultas;
  const repeticiones = Math.max(1, Math.floor(o.repeticiones));
  const superficie = o.superficie ? SUPERFICIES_BANCO[o.superficie] : undefined;
  const k = superficie?.k ?? 24;

  // Calentamiento: ejecuta consultas sin medirlas (conexión, caché de planes de Postgres).
  for (let i = 0; i < o.calentar && casos.length > 0; i++) {
    await deps.ejecutar(casos[i % casos.length].q).catch(() => undefined);
  }

  const todas: EvaluacionBusqueda[] = [];
  const primerasMs: number[] = [];
  let sinPlanCacheado = 0;
  for (const [idx, caso] of casos.entries()) {
    const muestras: number[] = [];
    let primero: ResultadoBanco | null = null;
    for (let rep = 0; rep < repeticiones; rep++) {
      const t0 = ahora();
      try {
        const r = await deps.ejecutar(caso.q);
        muestras.push(r.ms ?? ahora() - t0);
        if (rep === 0) primero = r;
      } catch (err) {
        if (rep === 0) {
          // Sólo el tipo de error y el índice: ni el mensaje (puede citar la consulta) ni la consulta.
          deps.log?.(`[banco] falló el caso #${idx}: ${err instanceof Error ? err.name : "desconocido"}`);
        }
      }
    }
    const resultado = primero ?? vacio();
    if (resultado.sinPlanCacheado) sinPlanCacheado++;
    if (resultado.ms != null) primerasMs.push(resultado.ms);
    const ev = evaluar({ ...caso, q: enmascarar ? `#${idx}` : caso.q }, resultado, deps.arbol, { k });
    if (resultado.etapa) ev.etapa = resultado.etapa;
    if (o.ids) ev.ids = (resultado.ids ?? []).slice(0, k);
    if (muestras.length) {
      ev.ms = muestras[0];
      ev.muestrasMs = muestras;
    }
    if (deps.sinGrabacion?.(caso)) ev.sinGrabacion = true;
    todas.push(ev);
  }

  const incluidas = todas.filter((e) => !e.sinGrabacion);
  const sinGrabacion = todas.length - incluidas.length;
  const conIntencion = o.tuberia === "v2" || o.tuberia === "motor";
  const resumen = resumenNumerico(incluidas, conIntencion);
  const duracionMs = ahora() - inicio;
  const { sha, sucio } = (deps.git ?? gitInfo)();

  const cabecera: Cabecera = {
    fecha: (deps.fecha ?? (() => new Date()))().toISOString(),
    gitSha: sha,
    sucio,
    tuberia: o.tuberia,
    jev: { modo: o.jev, modelo: o.jevMeta?.modelo ?? null, grabadoEl: o.jevMeta?.grabadoEl ?? null },
    banco: {
      origen: o.banco.origen,
      n: casos.length,
      hash: o.banco.hash,
      ...(o.banco.nRevisadas !== undefined ? { nRevisadas: o.banco.nRevisadas } : {}),
    },
    vista: { variante: o.produccion ? "produccion" : "banco", soloVisibles: o.vista.soloVisibles, soloStock: o.vista.soloStock },
    ...(o.umbral !== undefined ? { umbral: o.umbral } : {}),
    flags: Object.fromEntries(Object.entries(o.flagsDeclarados).sort(([a], [b]) => a.localeCompare(b))),
    snapshot: deps.snapshot,
    repeticiones,
    calentar: o.calentar,
    ...(o.parcial ? { parcial: o.parcial } : {}),
    ...(o.politica ? { politica: o.politica } : {}),
    ...(superficie ? { superficie } : {}),
    tenantAlias: o.tenantAlias,
    duracionMs,
    busquedaMedidas: o.busquedaMedidas ?? "no aplica",
  };

  const porEtapa: Record<string, number> = {};
  for (const e of incluidas) if (e.etapa) porEtapa[e.etapa] = (porEtapa[e.etapa] ?? 0) + 1;

  const json: ReporteJson = {
    esquema: 1,
    cabecera,
    resumen,
    cortes: {
      perfil: cortarPor(incluidas, "perfil", conIntencion),
      intencion: cortarPor(incluidas, "intencionEsperada", conIntencion),
      tipo: cortarPor(incluidas, "tipo", conIntencion),
    },
    latencia: resumen.latencia,
    excluidos: { sinGrabacion },
    casos: todas.map((e, idx) => ({
      idx,
      ...(enmascarar ? {} : { q: e.q }),
      tipo: e.tipo,
      perfil: e.perfil,
      posicion: e.posicion,
      rr: e.rr,
      precision: e.precision,
      total: e.total,
      ...(e.ms !== undefined ? { ms: e.ms } : {}),
      top24Ok: e.top24Ok,
      intencionOk: e.intencionOk,
      categoriaOk: e.categoriaOk,
      atributosOk: e.atributosOk,
      zero: e.zero,
      ...(e.sinGrabacion ? { sinGrabacion: true } : {}),
      ...(e.etapa ? { etapa: e.etapa } : {}),
      ...(e.ids ? { ids: e.ids } : {}),
    })),
    ...(o.jev === "cache" ? { sinPlanCacheado } : {}),
    ...(Object.keys(porEtapa).length ? { etapas: porEtapa } : {}),
  };

  const ordenadas = [...primerasMs].sort((a, b) => a - b);
  const p50Legado = ordenadas[Math.floor(ordenadas.length / 2)] ?? 0;
  const lineas = [
    `[banco] tubería ${o.tuberia}${o.politica ? ` (política ${o.politica}, superficie ${o.superficie ?? "catalogo"}, K=${k})` : ""}; banco ${o.banco.origen} (n=${casos.length}, hash ${o.banco.hash}); vista ${cabecera.vista.variante} (soloVisibles ${o.vista.soloVisibles}, soloStock ${o.vista.soloStock}); Jev ${o.jev}${o.jevMeta?.modelo ? ` (${o.jevMeta.modelo}, grabado ${o.jevMeta.grabadoEl ?? "?"})` : ""}; busqueda-medidas: ${cabecera.busquedaMedidas}`,
    "",
    reporte(`Banco de búsquedas — tubería ${o.tuberia}`, incluidas, conIntencion, k),
    "",
    `ms p50 por búsqueda: ${p50Legado}`,
    "",
    reporteAmpliado(incluidas, conIntencion, k),
  ];
  if (Object.keys(porEtapa).length) lineas.push("", `etapas: ${Object.entries(porEtapa).map(([e, n]) => `${e} ${n}`).join(", ")}`);
  if (sinGrabacion) lineas.push("", `${sinGrabacion} caso(s) sin grabación de Jev: excluidos de las métricas (no se llamó a Jev en vivo).`);
  if (o.jev === "cache") lineas.push("", `${sinPlanCacheado} consulta(s) sin plan cacheado: se usó el plan determinista.`);
  if (o.repeticiones > 1 || o.calentar) lineas.push("", `repeticiones ${repeticiones}, calentamiento ${o.calentar}: la relevancia sale de la 1ra repetición; p50/p95 de todas.`);
  lineas.push("", `Duración total: ${duracionMs} ms`);

  return { json, texto: `${lineas.join("\n")}\n`, evaluaciones: incluidas, conIntencion, puntaje: resumir(incluidas, conIntencion).puntaje };
}

export type ClaveComparable = "vista" | "jev" | "superficie" | "politica";

/**
 * ¿Dos corridas se pueden comparar? Mismo banco (hash), mismo snapshot del
 * catálogo, misma vista y mismo Jev. El sha y la fecha NO cuentan (se compara
 * justamente contra corridas futuras). `ignorar` deja pasar lo que difiere a
 * propósito (una matriz entre tuberías compara distintos Jev, o ambas vistas).
 */
export function sonComparables(a: Cabecera, b: Cabecera, { ignorar = [] }: { ignorar?: ClaveComparable[] } = {}): { ok: boolean; motivos: string[] } {
  const motivos: string[] = [];
  if (a.banco.hash !== b.banco.hash) motivos.push("el banco es distinto (hash)");
  if (JSON.stringify(a.snapshot) !== JSON.stringify(b.snapshot)) motivos.push("el snapshot del catálogo es distinto");
  if (!ignorar.includes("vista") && JSON.stringify(a.vista) !== JSON.stringify(b.vista)) motivos.push("la vista es distinta (banco/producción, visibles, stock)");
  if (!ignorar.includes("jev") && JSON.stringify(a.jev) !== JSON.stringify(b.jev)) motivos.push("el modo o la grabación de Jev es distinta");
  if (!ignorar.includes("superficie") && JSON.stringify(a.superficie) !== JSON.stringify(b.superficie)) motivos.push("la superficie es distinta");
  if (!ignorar.includes("politica") && a.politica !== b.politica) motivos.push("la política del motor es distinta");
  return { ok: motivos.length === 0, motivos };
}
