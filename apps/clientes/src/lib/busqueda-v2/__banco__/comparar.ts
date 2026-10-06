/**
 * `banco:linea-base --comparar=<snapshot>`: compara la corrida actual contra una línea base congelada (el
 * `matriz.json` de una corrida anterior) y muestra el delta por corrida y por tipo de consulta de hit@24,
 * medida-precision@24, contradicciones@24, inversiones@24 (orden), zero-result y p95 (spec busqueda-medidas R5.5). Módulo PURO salvo
 * `leerSnapshot` (lee un archivo; nunca toca la base). SÓLO agregados: ni consultas ni nombres de productos.
 *
 * La comparación se imprime aunque el banco o el snapshot del catálogo difieran, con una ADVERTENCIA: el
 * caso de uso es justamente comparar contra una corrida anterior (con otro estado del flag
 * `busqueda-medidas`, que la cabecera declara).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReporteJson } from "./corrida";
import { sonComparables } from "./corrida";
import type { CorridaDeMatriz } from "./matriz";
import type { ResumenNum } from "./metricas";

/** Forma de `matriz.json` (la que escribe `linea-base.ts`). */
export interface MatrizJson {
  esquema: number;
  generadoEl?: string;
  corridas: CorridaDeMatriz[];
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Valida la forma mínima que usa la comparación. El mensaje nunca cita el contenido. */
export function parsearSnapshot(json: unknown): MatrizJson {
  const mal = () => new Error("El snapshot no tiene la forma de un matriz.json de banco:linea-base (lista 'corridas' con 'id' y 'reporte').");
  if (!esObjeto(json) || !Array.isArray(json.corridas)) throw mal();
  for (const c of json.corridas) {
    if (!esObjeto(c) || typeof c.id !== "string" || !esObjeto(c.reporte)) throw mal();
    const r = c.reporte;
    if (!esObjeto(r.cabecera) || !esObjeto(r.resumen) || !esObjeto(r.cortes) || !esObjeto((r.cortes as Record<string, unknown>).tipo)) throw mal();
  }
  return json as unknown as MatrizJson;
}

/** Lee el snapshot de un archivo `matriz.json` o de una carpeta que lo contiene. */
export function leerSnapshot(ruta: string): MatrizJson {
  const archivo = existsSync(ruta) && statSync(ruta).isDirectory() ? join(ruta, "matriz.json") : ruta;
  let texto: string;
  try {
    texto = readFileSync(archivo, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`No existe el snapshot: ${archivo}`);
    throw new Error(`No se pudo leer el snapshot: ${archivo}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    // El mensaje de JSON.parse cita un fragmento del contenido: no se reenvía.
    throw new Error(`El snapshot no es un JSON válido: ${archivo}`);
  }
  return parsearSnapshot(json);
}

// --- Formato ------------------------------------------------------------------------------------------

const signo = (d: number) => (d >= 0 ? "+" : "");
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

/** `62.5% → 70.0% (+7.5 pp)`, o n/a si alguno de los lados no tiene el dato. */
function tasa(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null) return "n/a";
  const d = 100 * (b - a);
  return `${pct(a)} → ${pct(b)} (${signo(d)}${d.toFixed(1)} pp)`;
}

function entero(a: number | null | undefined, b: number | null | undefined, unidad = ""): string {
  if (a == null || b == null) return "n/a";
  const d = b - a;
  return `${a} → ${b}${unidad} (${signo(d)}${d})`;
}

interface Metricas {
  hit24: number | null;
  medidaPrecision: number | null;
  contradicciones: number | null;
  inversiones: number | null;
  zeroRate: number | null;
  p95: number | null;
}

function metricasDe(r: ResumenNum | undefined): Metricas | undefined {
  if (!r) return undefined;
  return {
    hit24: r.hit24,
    medidaPrecision: r.medida?.precision ?? null,
    contradicciones: r.medida ? r.medida.contradicciones : null,
    // Un snapshot anterior a la métrica de orden no la trae: n/a, no 0.
    inversiones: r.medida?.inversiones ?? null,
    zeroRate: r.n ? r.zeroRate : null,
    p95: r.latencia.n ? r.latencia.p95 : null,
  };
}

function fila(nombre: string, a: ResumenNum | undefined, b: ResumenNum | undefined): string {
  const x = metricasDe(a);
  const y = metricasDe(b);
  return [
    nombre.padEnd(18),
    tasa(x?.hit24, y?.hit24),
    tasa(x?.medidaPrecision, y?.medidaPrecision),
    entero(x?.contradicciones, y?.contradicciones),
    entero(x?.inversiones, y?.inversiones),
    tasa(x?.zeroRate, y?.zeroRate),
    entero(x?.p95, y?.p95, " ms"),
  ].join(" | ");
}

const cabeceraDe = (r: ReporteJson) => {
  const c = r.cabecera;
  return `git ${c.gitSha}${c.sucio ? " (árbol con cambios)" : ""} | ${c.fecha.slice(0, 10)} | busqueda-medidas: ${c.busquedaMedidas ?? "sin dato"} | banco ${c.banco.origen} n=${c.banco.n} hash ${c.banco.hash}`;
};

/**
 * Texto de la comparación `anterior` (snapshot congelado) → `actual`, por corrida común (mismo `id`):
 * total y cada tipo de consulta. Una corrida que está de un solo lado se lista aparte.
 */
export function compararMatrices(anterior: MatrizJson, actual: MatrizJson): string {
  const idsAntes = new Map(anterior.corridas.map((c) => [c.id, c]));
  const idsAhora = new Map(actual.corridas.map((c) => [c.id, c]));
  const comunes = actual.corridas.filter((c) => idsAntes.has(c.id));
  const lineas = ["# Comparación contra el snapshot", ""];
  if (!comunes.length) lineas.push("No hay corridas en común entre el snapshot y la corrida actual.");
  const primera = comunes[0];
  if (primera) {
    lineas.push(`snapshot: ${cabeceraDe(idsAntes.get(primera.id)!.reporte)}`, `actual:   ${cabeceraDe(primera.reporte)}`);
  }
  for (const c of comunes) {
    const antes = idsAntes.get(c.id)!;
    const { ok, motivos } = sonComparables(antes.reporte.cabecera, c.reporte.cabecera, { ignorar: ["vista", "jev"] });
    if (!ok) lineas.push(`ADVERTENCIA (${c.id}): el snapshot y la corrida actual difieren (${motivos.join("; ")}): el delta mezcla ese cambio.`);
  }
  for (const c of comunes) {
    const antes = idsAntes.get(c.id)!;
    const tipos = [...new Set([...Object.keys(antes.reporte.cortes.tipo), ...Object.keys(c.reporte.cortes.tipo)])].sort();
    lineas.push(
      "",
      `## ${c.id}`,
      "corte              | hit@24 | medida-precision@24 | contradicciones@24 | inversiones@24 | zero-result | p95",
      fila("total", antes.reporte.resumen, c.reporte.resumen),
      ...tipos.map((t) => fila(t, antes.reporte.cortes.tipo[t], c.reporte.cortes.tipo[t])),
    );
  }
  const soloAntes = anterior.corridas.filter((c) => !idsAhora.has(c.id)).map((c) => c.id);
  const soloAhora = actual.corridas.filter((c) => !idsAntes.has(c.id)).map((c) => c.id);
  if (soloAntes.length) lineas.push("", `sólo en el snapshot: ${soloAntes.join(", ")}`);
  if (soloAhora.length) lineas.push("", `sólo en la corrida actual: ${soloAhora.join(", ")}`);
  lineas.push("", "Notas: n/a = alguno de los lados no tiene el dato (por ejemplo, el snapshot es anterior a las métricas de medidas). Sólo agregados.");
  return `${lineas.join("\n")}\n`;
}
