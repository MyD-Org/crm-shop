/**
 * Argumentos de `npm run banco:busqueda` y de `banco:linea-base`: parseo PURO
 * (falla antes de abrir ninguna conexión) y carga del banco elegido.
 *
 * Sin flags nuevos el comportamiento es el de siempre: tubería v2, Jev
 * grabado, umbral 85, vista actual del banco (soloVisibles false, stock =
 * todos) y banco versionado. Los flags nuevos son aditivos.
 */
import { basename } from "node:path";
import { BANCO } from "./banco";
import { cargarBancoDeArchivo, filtrarEtiquetas, hashBanco, type CasosFiltrados, type ModoEtiquetas, validarBanco } from "./cargar-banco";
import type { BancoDeCorrida, ModoJev, PoliticaBanco, SuperficieBanco, Tuberia } from "./corrida";

export const TUBERIAS: readonly Tuberia[] = ["clasica", "tolerante", "fase1", "v2", "motor"];
export const POLITICAS: readonly PoliticaBanco[] = ["legado", "cascada"];
export const SUPERFICIES: readonly SuperficieBanco[] = ["catalogo", "autocompletar", "chat"];
const MODOS_JEV = ["grabado", "vivo", "no", "cache"] as const;
const FLAGS_CONOCIDOS = new Set([
  "tuberia", "jev", "umbral", "salida", "solo", "ver", "banco", "etiquetas", "produccion", "solo-visibles",
  "flags", "json", "repeticiones", "calentar", "ver-consultas", "tenant-alias",
  "politica", "superficie", "paridad", "paridad-con", "ids",
  "medidas",
]);

export interface ArgsBanco {
  tuberia: Tuberia;
  /** `segun-entorno` (sólo fase1 sin --jev): Jev si hay JEV_API_KEY, como siempre. */
  jev: ModoJev | "segun-entorno";
  umbral: number;
  /** Reporte de texto (flag histórico). */
  salida?: string;
  /** Reporte JSON. */
  json?: string;
  solo?: "diagnostico";
  /** `--ver=N`: muestra N productos por búsqueda en consola (nunca en el reporte). */
  ver: number;
  banco?: string;
  etiquetas: ModoEtiquetas;
  produccion: boolean;
  soloVisibles?: boolean;
  flags: Record<string, "on" | "off">;
  repeticiones: number;
  calentar: number;
  verConsultas: boolean;
  tenantAlias: string;
  /** Sólo `--tuberia=motor`: política del motor (por defecto `legado`) y superficie (por defecto `catalogo`). */
  politica?: PoliticaBanco;
  superficie?: SuperficieBanco;
  /** `--paridad`: el motor `legado` contra el oráculo legado, caso por caso (exit 1 si difieren). */
  paridad: boolean;
  /** `--paridad-con=<json>`: contra los ids de una corrida previa (misma cabecera). */
  paridadCon?: string;
  /** `--ids`: guardar en el JSON los ids de lo devuelto (archivo local; nunca a consola). */
  ids: boolean;
  /**
   * `--medidas=si|no` (por defecto si): aplicar las medidas de la consulta al plan (`aplicarMedidas`) en las
   * tuberías que usan plan (v2, motor). `no` reproduce la corrida de antes con el mismo código. El flag de
   * Vercel `busqueda-medidas` NO se lee acá: el banco lo fuerza con este argumento.
   */
  medidas: boolean;
  avisos: string[];
}

/**
 * Estado de las medidas que declara la cabecera de la corrida: sólo las tuberías con plan v2 (v2 y motor)
 * las aplican; clasica, tolerante y fase1 no usan el plan de la v2 ("no aplica").
 */
export function estadoMedidas(tuberia: Tuberia, medidas: boolean): "no aplica" | "on" | "off" {
  return tuberia === "v2" || tuberia === "motor" ? (medidas ? "on" : "off") : "no aplica";
}

const entero = (nombre: string, v: string | undefined, min: number, def: number): number => {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${nombre} debe ser un entero >= ${min}.`);
  return n;
};

/** `--k=v` o `--k` (valor "1"), como siempre. Lanza con un mensaje claro ante cualquier valor inválido. */
export function parsearArgs(argv: readonly string[]): ArgsBanco {
  const mapa = new Map<string, string>();
  for (const a of argv) {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    mapa.set(k, v.join("=") || "1");
  }
  for (const k of mapa.keys()) {
    if (!FLAGS_CONOCIDOS.has(k)) throw new Error(`Flag desconocido: --${k}. Válidos: ${[...FLAGS_CONOCIDOS].map((f) => `--${f}`).join(", ")}.`);
  }
  const avisos: string[] = [];

  const tuberia = (mapa.get("tuberia") ?? "v2") as Tuberia;
  if (!TUBERIAS.includes(tuberia)) throw new Error(`--tuberia inválida: use ${TUBERIAS.join("|")}.`);

  const jevPedido = mapa.get("jev");
  if (jevPedido !== undefined && !MODOS_JEV.includes(jevPedido as never)) throw new Error(`--jev inválido: use ${MODOS_JEV.join("|")}.`);
  let jev: ArgsBanco["jev"];
  if (tuberia === "clasica" || tuberia === "tolerante") {
    jev = "no aplica";
  } else if (tuberia === "fase1") {
    if (jevPedido === "grabado" || jevPedido === "cache") throw new Error(`--jev=${jevPedido} no aplica a la tubería fase1 (sólo vivo|no).`);
    jev = jevPedido === undefined ? "segun-entorno" : (jevPedido as ModoJev);
  } else {
    jev = (jevPedido ?? "grabado") as ModoJev;
  }

  const produccion = mapa.has("produccion");
  let soloVisibles: boolean | undefined;
  const sv = mapa.get("solo-visibles");
  if (sv !== undefined && sv !== "si" && sv !== "no") throw new Error("--solo-visibles debe ser si|no.");
  if (produccion) {
    if (sv === undefined) throw new Error("--produccion exige --solo-visibles=si|no (el valor del flag catalogo-solo-visibles en producción).");
    soloVisibles = sv === "si";
  } else if (sv !== undefined) {
    avisos.push("[aviso] --solo-visibles se ignora sin --produccion.");
  }

  const flags: Record<string, "on" | "off"> = {};
  for (const par of (mapa.get("flags") ?? "").split(",").filter(Boolean)) {
    const [nombre, valor, ...resto] = par.split(":");
    if (!nombre || valor === undefined || resto.length) throw new Error("--flags debe ser nombre:on|off separados por coma.");
    if (valor !== "on" && valor !== "off") throw new Error(`--flags: el valor de «${nombre}» debe ser on|off.`);
    flags[nombre] = valor;
  }

  const etiquetas = (mapa.get("etiquetas") ?? "revisado") as ModoEtiquetas;
  if (etiquetas !== "revisado" && etiquetas !== "todas") throw new Error("--etiquetas debe ser revisado|todas.");

  const solo = mapa.get("solo");
  if (solo !== undefined && solo !== "diagnostico") throw new Error("--solo sólo admite diagnostico.");

  // Tubería `motor`: política y superficie (el default de política es `legado` hasta que la cascada exista).
  const esMotor = tuberia === "motor";
  for (const flag of ["politica", "superficie", "paridad", "paridad-con"]) {
    if (mapa.has(flag) && !esMotor) throw new Error(`--${flag} sólo vale con --tuberia=motor.`);
  }
  const politicaPedida = mapa.get("politica");
  if (politicaPedida !== undefined && !POLITICAS.includes(politicaPedida as PoliticaBanco)) throw new Error(`--politica inválida: use ${POLITICAS.join("|")}.`);
  const superficiePedida = mapa.get("superficie");
  if (superficiePedida !== undefined && !SUPERFICIES.includes(superficiePedida as SuperficieBanco)) throw new Error(`--superficie inválida: use ${SUPERFICIES.join("|")}.`);
  const politica = esMotor ? ((politicaPedida ?? "legado") as PoliticaBanco) : undefined;
  const superficie = esMotor ? ((superficiePedida ?? "catalogo") as SuperficieBanco) : undefined;
  const paridad = mapa.has("paridad");
  const paridadCon = mapa.get("paridad-con");
  if (paridad && paridadCon !== undefined) throw new Error("--paridad y --paridad-con no se combinan: elija uno.");
  if (paridad && politica !== "legado") throw new Error("--paridad compara la política legado contra el oráculo: no admite --politica=cascada.");

  const medidasPedido = mapa.get("medidas");
  if (medidasPedido !== undefined && medidasPedido !== "si" && medidasPedido !== "no") throw new Error("--medidas debe ser si|no.");

  return {
    tuberia,
    jev,
    // Sólo v2 tiene umbral (los demás miden, no aprueban); un --umbral explícito manda.
    umbral: Number(mapa.get("umbral") ?? (tuberia === "v2" ? 85 : 0)),
    ...(politica ? { politica } : {}),
    ...(superficie ? { superficie } : {}),
    paridad,
    ...(paridadCon !== undefined ? { paridadCon } : {}),
    // `--paridad-con` compara contra ids: la corrida actual tiene que guardarlos.
    ids: mapa.has("ids") || paridadCon !== undefined,
    medidas: medidasPedido !== "no",
    ...(mapa.has("salida") ? { salida: mapa.get("salida") } : {}),
    ...(mapa.has("json") ? { json: mapa.get("json") } : {}),
    ...(solo ? { solo: "diagnostico" as const } : {}),
    ver: Number(mapa.get("ver") ?? 0),
    ...(mapa.has("banco") ? { banco: mapa.get("banco") } : {}),
    etiquetas,
    produccion,
    ...(soloVisibles !== undefined ? { soloVisibles } : {}),
    flags,
    repeticiones: entero("repeticiones", mapa.get("repeticiones"), 1, 1),
    calentar: entero("calentar", mapa.get("calentar"), 0, 0),
    verConsultas: mapa.has("ver-consultas"),
    tenantAlias: mapa.get("tenant-alias") ?? "shop",
    avisos,
  };
}

export interface BancoElegido {
  banco: BancoDeCorrida;
  /** Casos que no entraron por su estado de revisión (sólo conteos). */
  excluidos: CasosFiltrados["excluidos"];
  /** Avisos de `validarBanco` (sólo conteos). */
  avisos: string[];
}

/**
 * Carga el banco que pide `--banco` (o el versionado) y aplica `--etiquetas` y
 * `--solo`. Falla (sin tocar la base) si el archivo no existe o es inválido.
 * `categoriasVigentes`: nombres del árbol vivo, para avisar categorías que no existen.
 */
export function cargarBancoDeArgs(a: Pick<ArgsBanco, "banco" | "etiquetas" | "solo">, categoriasVigentes?: readonly string[]): BancoElegido {
  const sinExcluir = { pendiente: 0, propuesto: 0, descartado: 0 };
  if (!a.banco) {
    const casos = a.solo ? BANCO.filter((c) => c.diagnostico) : BANCO;
    return { banco: { origen: "versionado", local: false, privado: false, casos, hash: hashBanco(casos) }, excluidos: sinExcluir, avisos: [] };
  }
  const cargado = cargarBancoDeArchivo(a.banco);
  const { casos: filtrados, excluidos } = filtrarEtiquetas(cargado.casos, a.etiquetas);
  const casos = a.solo ? filtrados.filter((c) => c.diagnostico) : filtrados;
  const { avisos } = validarBanco(casos, categoriasVigentes ?? cargado.categorias);
  return {
    banco: { origen: basename(a.banco), local: true, privado: cargado.privado, casos, hash: hashBanco(casos), nRevisadas: casos.length },
    excluidos,
    avisos,
  };
}
