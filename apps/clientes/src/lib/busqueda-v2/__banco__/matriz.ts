/**
 * Matriz de la línea base (`npm run banco:linea-base`): qué corridas se
 * hacen, cómo se leen los argumentos y cómo se resume el resultado. Módulo
 * PURO (sin base ni red): el runner es `linea-base.ts`.
 *
 * Matriz = tuberías x vistas (banco / producción) x bancos (sintético
 * versionado y, si se pasa, el real local). El banco real mide v2 con el plan
 * que sirvió la caché de producción (`--jev=cache`): el Jev grabado sólo cubre
 * las consultas sintéticas. Jev vivo (gasta) sólo con `--jev=vivo` explícito
 * y únicamente sobre el banco sintético.
 *
 * Con `--motor` (aditivo) la matriz suma las filas de la tubería `motor`: por banco y vista, el
 * motor con política `legado` (la cascada se agrega cuando exista) en la superficie catálogo
 * (ambas vistas) y en autocompletar y chat (sólo la vista de producción, que es la que ven).
 * Los ids de las filas de siempre no cambian.
 */
import { sonComparables, type ModoJev, type PoliticaBanco, type ReporteJson, type SuperficieBanco, type Tuberia } from "./corrida";
import type { ResumenNum } from "./metricas";
import type { ModoEtiquetas } from "./cargar-banco";

export type BancoDeMatriz = "sintetico" | "real";
export type VistaDeMatriz = "banco" | "produccion";

export interface EntradaMatriz {
  id: string;
  banco: BancoDeMatriz;
  vista: VistaDeMatriz;
  tuberia: Tuberia;
  jev: ModoJev;
  /** Sólo filas de la tubería `motor`. */
  politica?: PoliticaBanco;
  superficie?: SuperficieBanco;
}

export interface CorridaDeMatriz {
  id: string;
  banco: BancoDeMatriz;
  vista: VistaDeMatriz;
  tuberia: Tuberia;
  jev: ModoJev;
  politica?: PoliticaBanco;
  superficie?: SuperficieBanco;
  reporte: ReporteJson;
}

const VISTAS: readonly VistaDeMatriz[] = ["banco", "produccion"];

function motoresDe(banco: BancoDeMatriz, jevVivo: boolean): { tuberia: Tuberia; jev: ModoJev }[] {
  return [
    { tuberia: "clasica", jev: "no aplica" },
    { tuberia: "tolerante", jev: "no aplica" },
    // La corrida congelada no gasta: fase1 nunca llama a Jev.
    { tuberia: "fase1", jev: "no" },
    { tuberia: "v2", jev: "no" },
    banco === "real" ? { tuberia: "v2", jev: "cache" } : { tuberia: "v2", jev: "grabado" },
    ...(banco === "sintetico" && jevVivo ? [{ tuberia: "v2" as const, jev: "vivo" as const }] : []),
  ];
}

const sufijoJev = (jev: ModoJev) => (jev === "no aplica" ? "" : `-${jev === "no" ? "sinjev" : jev}`);

/** Políticas del motor que miden las filas `--motor` (la cascada se suma cuando exista). */
const POLITICAS_MOTOR: readonly PoliticaBanco[] = ["legado"];

/** Superficies del motor por vista: la de producción es la que ven autocompletar y chat. */
const SUPERFICIES_POR_VISTA: Record<VistaDeMatriz, readonly SuperficieBanco[]> = {
  banco: ["catalogo"],
  produccion: ["catalogo", "autocompletar", "chat"],
};

/** Las corridas de la matriz, en orden estable: banco, vista y motor. */
export function planDeMatriz({ bancoReal, jevVivo, motor = false }: { bancoReal: boolean; jevVivo: boolean; motor?: boolean }): EntradaMatriz[] {
  const bancos: BancoDeMatriz[] = bancoReal ? ["sintetico", "real"] : ["sintetico"];
  return bancos.flatMap((banco) =>
    VISTAS.flatMap((vista): EntradaMatriz[] => [
      ...motoresDe(banco, jevVivo).map(({ tuberia, jev }) => ({ id: `${banco}-${vista}-${tuberia}${sufijoJev(jev)}`, banco, vista, tuberia, jev })),
      ...(motor
        ? POLITICAS_MOTOR.flatMap((politica) =>
            SUPERFICIES_POR_VISTA[vista].map((superficie) => ({
              id: `${banco}-${vista}-motor-${politica}-${superficie}`,
              banco,
              vista,
              tuberia: "motor" as const,
              // Como v2: el banco real usa el plan que sirvió la caché de producción; el sintético, el Jev grabado.
              jev: banco === "real" ? ("cache" as const) : ("grabado" as const),
              politica,
              superficie,
            })),
          )
        : []),
    ]),
  );
}

export interface ArgsLinea {
  /** Valor de `catalogo-solo-visibles` en producción (obligatorio: define la vista "produccion" y la clave de los planes cacheados). */
  soloVisibles: boolean;
  flags: Record<string, "on" | "off">;
  bancoReal?: string;
  etiquetas: ModoEtiquetas;
  repeticiones: number;
  calentar: number;
  dir?: string;
  jevVivo: boolean;
  /** `--motor`: suma las filas de la tubería `motor`. */
  motor: boolean;
  tenantAlias: string;
  /** `--comparar=<ruta>`: matriz.json (o carpeta que lo contiene) de una línea base congelada, para imprimir el delta. */
  comparar?: string;
  /** `--medidas=si|no` (por defecto si): aplicar las medidas al plan en v2 y motor (ver `ArgsBanco.medidas`). */
  medidas: boolean;
}

const CONOCIDOS = new Set(["solo-visibles", "flags", "banco-real", "etiquetas", "repeticiones", "calentar", "dir", "jev", "tenant-alias", "motor", "comparar", "medidas"]);

const entero = (nombre: string, v: string | undefined, min: number, def: number): number => {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${nombre} debe ser un entero >= ${min}.`);
  return n;
};

export function parsearArgsLinea(argv: readonly string[]): ArgsLinea {
  const mapa = new Map<string, string>();
  for (const a of argv) {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    mapa.set(k, v.join("=") || "1");
  }
  for (const k of mapa.keys()) {
    if (!CONOCIDOS.has(k)) throw new Error(`Flag desconocido: --${k}. Válidos: ${[...CONOCIDOS].map((f) => `--${f}`).join(", ")}.`);
  }
  const sv = mapa.get("solo-visibles");
  if (sv !== "si" && sv !== "no") throw new Error("Falta --solo-visibles=si|no (el valor de catalogo-solo-visibles en producción; ver `vercel flags inspect`).");

  const flags: Record<string, "on" | "off"> = {};
  for (const par of (mapa.get("flags") ?? "").split(",").filter(Boolean)) {
    const [nombre, valor, ...resto] = par.split(":");
    if (!nombre || valor === undefined || resto.length) throw new Error("--flags debe ser nombre:on|off separados por coma.");
    if (valor !== "on" && valor !== "off") throw new Error(`--flags: el valor de «${nombre}» debe ser on|off.`);
    flags[nombre] = valor;
  }
  const jev = mapa.get("jev");
  if (jev !== undefined && jev !== "vivo") throw new Error("--jev sólo admite vivo (Jev en vivo gasta: pídalo explícitamente).");
  const etiquetas = (mapa.get("etiquetas") ?? "revisado") as ModoEtiquetas;
  if (etiquetas !== "revisado" && etiquetas !== "todas") throw new Error("--etiquetas debe ser revisado|todas.");

  const medidas = mapa.get("medidas");
  if (medidas !== undefined && medidas !== "si" && medidas !== "no") throw new Error("--medidas debe ser si|no.");

  return {
    soloVisibles: sv === "si",
    medidas: medidas !== "no",
    flags,
    ...(mapa.has("banco-real") ? { bancoReal: mapa.get("banco-real") } : {}),
    etiquetas,
    repeticiones: entero("repeticiones", mapa.get("repeticiones"), 1, 3),
    calentar: entero("calentar", mapa.get("calentar"), 0, 3),
    ...(mapa.has("dir") ? { dir: mapa.get("dir") } : {}),
    jevVivo: jev === "vivo",
    motor: mapa.has("motor"),
    tenantAlias: mapa.get("tenant-alias") ?? "shop",
    ...(mapa.has("comparar") ? { comparar: mapa.get("comparar") } : {}),
  };
}

// --- Texto de la matriz (sólo agregados) -----------------------------------------------------------------

const pct = (x: number | null) => (x === null ? "n/a" : `${(100 * x).toFixed(1)}%`);
const dec = (x: number | null, d = 3) => (x === null ? "n/a" : x.toFixed(d));
const num = (n: number, hay: boolean) => (hay ? String(n) : "n/a");

function motor(c: CorridaDeMatriz): string {
  // Cada fila del motor dice su política, su superficie y el K con que se evalúa.
  if (c.tuberia === "motor") return `motor ${c.politica ?? c.reporte.cabecera.politica}/${c.superficie ?? c.reporte.cabecera.superficie?.nombre} K=${c.reporte.cabecera.superficie?.k ?? 24}`;
  if (c.tuberia !== "v2") return c.tuberia;
  return `v2 (${c.jev === "no" ? "sin Jev" : c.jev})`;
}

function fila(nombre: string, r: ResumenNum): string {
  return [
    nombre.padEnd(14),
    r.n,
    pct(r.hit24),
    pct(r.hit3),
    dec(r.mrr),
    pct(r.precision24),
    `${r.zeroTotal} (${pct(r.n ? r.zeroRate : null)})`,
    `${r.zeroIndebido} (${pct(r.n ? r.zeroIndebidoRate : null)})`,
    num(r.latencia.p50, r.latencia.n > 0),
    num(r.latencia.p95, r.latencia.n > 0),
    r.puntaje,
  ].join(" | ");
}

const diferenciaPp = (a: number | null, b: number | null) => (a === null || b === null ? "n/a" : `${a - b >= 0 ? "+" : ""}${(100 * (a - b)).toFixed(1)} pp`);
const diferencia = (a: number | null, b: number | null) => (a === null || b === null ? "n/a" : `${a - b >= 0 ? "+" : ""}${(a - b).toFixed(3)}`);

/**
 * `matriz.txt`: tabla motor x métricas por banco y vista, delta con/sin Jev
 * y advertencias de comparabilidad. SÓLO agregados (ni consultas ni nombres de
 * productos). Los casos individuales viven en `matriz.json` (enmascarados en el banco real).
 */
export function formatearMatriz(corridas: readonly CorridaDeMatriz[]): string {
  if (!corridas.length) return "Matriz vacía.\n";
  const primera = corridas[0].reporte.cabecera;
  const lineas = [
    "# Línea base de la búsqueda (matriz)",
    "",
    `fecha ${primera.fecha} | git ${primera.gitSha}${primera.sucio ? " (árbol con cambios)" : ""} | alias ${primera.tenantAlias}`,
    `flags declarados: ${Object.entries(primera.flags).map(([k, v]) => `${k}=${v}`).join(", ") || "(ninguno)"}`,
    // Las filas del motor se leen con el estado de las medidas declarado (flag `busqueda-medidas`).
    `medidas: ${primera.flags["busqueda-medidas"] ?? "no declarado"}`,
    `repeticiones ${primera.repeticiones}, calentamiento ${primera.calentar}`,
    `snapshot: ${JSON.stringify(primera.snapshot)}`,
  ];

  // Lo que aplicó la tubería con plan (`--medidas=si|no`); el flag de arriba es lo que se declaró de Vercel.
  const aplicadas = corridas.find((c) => c.tuberia === "v2" || c.tuberia === "motor")?.reporte.cabecera.busquedaMedidas;
  if (aplicadas && aplicadas !== "no aplica") lineas.push(`medidas aplicadas (v2/motor): ${aplicadas}`);

  const bancos = [...new Set(corridas.map((c) => c.banco))];
  for (const banco of bancos) {
    const delBanco = corridas.filter((c) => c.banco === banco);
    const b = delBanco[0].reporte.cabecera.banco;
    lineas.push("", `## Banco ${banco}: ${b.origen}, n=${b.n}, hash ${b.hash}`);
    const [base, ...resto] = delBanco;
    for (const c of resto) {
      const { ok, motivos } = sonComparables(base.reporte.cabecera, c.reporte.cabecera, { ignorar: ["vista", "jev", "superficie", "politica"] });
      if (!ok) lineas.push(`ADVERTENCIA: ${base.id} y ${c.id} no son comparables: ${motivos.join("; ")}.`);
    }
    for (const vista of VISTAS) {
      const grupo = delBanco.filter((c) => c.vista === vista);
      if (!grupo.length) continue;
      const v = grupo[0].reporte.cabecera.vista;
      lineas.push(
        "",
        `### Vista ${vista} (soloVisibles ${v.soloVisibles}, soloStock ${v.soloStock})`,
        "motor          | n | hit@24 | hit@3 | MRR | precision@24 | zero total | zero indebido | p50 ms | p95 ms | puntaje",
        ...grupo.map((c) => fila(motor(c), c.reporte.resumen)),
      );
      // Qué etapa resolvió cada búsqueda del motor (sólo conteos).
      for (const c of grupo.filter((x) => x.tuberia === "motor" && x.reporte.etapas)) {
        lineas.push(`etapas ${motor(c).replace(/ K=\d+$/, "")}: ${Object.entries(c.reporte.etapas!).map(([e, n]) => `${e} ${n}`).join(", ")}`);
      }
      const sinJev = grupo.find((c) => c.tuberia === "v2" && c.jev === "no");
      for (const conJev of grupo.filter((c) => c.tuberia === "v2" && (c.jev === "grabado" || c.jev === "cache" || c.jev === "vivo"))) {
        if (!sinJev) continue;
        const a = conJev.reporte.resumen;
        const s = sinJev.reporte.resumen;
        lineas.push(
          `Delta ${motor(conJev)} − v2 (sin Jev): hit@24 ${diferenciaPp(a.hit24, s.hit24)} | MRR ${diferencia(a.mrr, s.mrr)} | zero ${diferenciaPp(a.zeroRate, s.zeroRate)}`,
        );
      }
    }
  }
  lineas.push("", "Notas: precision@24 es un proxy (esperados o de la categoría buscada sobre los productos devueltos). Disponibilidad por sucursal no se modela (se asume stock único).");
  return `${lineas.join("\n")}\n`;
}
