/**
 * `npm run busqueda:compilar-banco` — compila el banco real local a partir de
 * las propuestas de etiquetas revisadas por una persona (slice B de la línea
 * base de búsqueda). Sin base de datos ni red: sólo lee y escribe archivos
 * locales ignorados por git.
 *
 *   npm run busqueda:compilar-banco
 *   npm run busqueda:compilar-banco -- --propuestas=tmp/busqueda/banco-propuestas.local.json \
 *     --consultas=tmp/busqueda/consultas-reales.local.json --salida=tmp/busqueda/banco-real.local.json
 *
 * Entrada (`--propuestas`, por defecto tmp/busqueda/banco-propuestas.local.json):
 * el formato del banco (`{ version, categorias?, busquedas: [...] }`, ver
 * `src/lib/busqueda-v2/__banco__/banco-propuestas.ejemplo.json`). Cada caso lleva
 * `etiquetado`: `propuesto` (lo escribió el subagente), `revisado` (lo confirmó la
 * usuaria) o `descartado`. SÓLO los `revisado` entran al banco real; un caso sin
 * estado no cuenta como revisado.
 * Las categorías válidas salen de `categorias` del mismo archivo o, si no las trae,
 * de `--consultas` (tmp/busqueda/consultas-reales.local.json, que las vuelca la
 * extracción). Una categoría que no está en el árbol vigente falla con el índice
 * del caso (nunca con el texto de la consulta).
 *
 * Salida (`--salida`, por defecto tmp/busqueda/banco-real.local.json): banco
 * `{ version: 1, origen: "real", privado: true, ... }`, cargable con
 * `npm run banco:busqueda -- --banco=<ruta>`. La ruta DEBE estar ignorada por git
 * (o fuera del repo): si no, el script aborta antes de escribir. La consola sólo
 * muestra conteos.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { filtrarEtiquetas, parsearBanco, validarBanco } from "@/lib/busqueda-v2/__banco__/cargar-banco";
import type { BusquedaBanco } from "@/lib/busqueda-v2/__banco__/modelo";
import { resolverSalida } from "@/lib/busqueda-v2/__banco__/ruta-salida";

const OBJETIVO = 100;

export interface BancoRealCompilado {
  version: 1;
  origen: "real";
  privado: true;
  /** Árbol vigente con el que se etiquetó (lo usa `validarBanco` al cargar). */
  categorias: string[];
  busquedas: BusquedaBanco[];
}

export interface ResumenCompilacion {
  total: number;
  revisadas: number;
  descartadas: number;
  propuestas: number;
  pendientes: number;
  /** Casos sin `etiquetado`: no cuentan como revisados. */
  sinEstado: number;
  menorA100: boolean;
  motivo?: string;
  /** Avisos legibles: sólo conteos. */
  avisos: string[];
}

/**
 * Banco real a partir de las propuestas. Puro: lanza un único error (índice +
 * campo, nunca valores) ante un esquema inválido, una categoría inexistente en
 * un caso revisado o ningún caso revisado.
 */
export function compilarBancoReal(
  propuestas: unknown,
  categoriasVigentes: readonly string[],
): { banco: BancoRealCompilado; resumen: ResumenCompilacion } {
  const { casos } = parsearBanco(propuestas, { origen: "local" });
  const vigentes = new Set(categoriasVigentes);

  const errores: string[] = [];
  casos.forEach((c, i) => {
    if (c.etiquetado !== "revisado") return;
    for (const campo of ["categoria", "categoriaEnTop24"] as const) {
      if (c[campo]?.some((n) => !vigentes.has(n))) {
        errores.push(`caso #${i}: campo '${campo}' tiene una categoría que no existe en el árbol vigente`);
      }
    }
  });
  if (errores.length) throw new Error(`Propuestas inválidas (${errores.length} problema(s)):\n${errores.join("\n")}`);

  const cuenta = (e: BusquedaBanco["etiquetado"]) => casos.filter((c) => c.etiquetado === e).length;
  // `filtrarEtiquetas` deja pasar los casos sin estado (así carga el banco embebido): acá no, sólo cuenta lo que marcó la usuaria.
  const revisadas = filtrarEtiquetas(casos, "revisado").casos.filter((c) => c.etiquetado === "revisado");
  const sinEstado = casos.filter((c) => !c.etiquetado).length;
  if (!revisadas.length) {
    throw new Error("Ninguna propuesta está revisada: marque `etiquetado: \"revisado\"` en las que confirme (las demás no entran al banco real).");
  }

  const menorA100 = revisadas.length < OBJETIVO;
  const resumen: ResumenCompilacion = {
    total: casos.length,
    revisadas: revisadas.length,
    descartadas: cuenta("descartado"),
    propuestas: cuenta("propuesto"),
    pendientes: cuenta("pendiente"),
    sinEstado,
    menorA100,
    ...(menorA100
      ? { motivo: `n < ${OBJETIVO}: sólo hay ${revisadas.length} caso(s) revisado(s) de ${casos.length}; se compilan todos los revisados` }
      : {}),
    avisos: [...validarBanco(revisadas, [...vigentes]).avisos],
  };
  if (sinEstado) resumen.avisos.push(`${sinEstado} caso(s) sin 'etiquetado' quedaron fuera (no cuentan como revisados)`);

  return {
    banco: {
      version: 1,
      origen: "real",
      privado: true,
      categorias: [...vigentes],
      busquedas: revisadas.map((c) => ({ ...c, etiquetado: "revisado" as const })),
    },
    resumen,
  };
}

/** Texto de consola: sólo conteos y avisos. */
export function textoCompilacion(r: ResumenCompilacion): string {
  return [
    `Propuestas: ${r.total} | revisadas: ${r.revisadas} | descartadas: ${r.descartadas} | propuestas sin revisar: ${r.propuestas} | pendientes: ${r.pendientes} | sin estado: ${r.sinEstado}`,
    ...(r.motivo ? [`AVISO: ${r.motivo}`] : []),
    ...r.avisos.map((a) => `AVISO: ${a}`),
  ].join("\n");
}

function arg(argv: readonly string[], nombre: string, def: string): string {
  const a = argv.find((x) => x.startsWith(`--${nombre}=`));
  return a ? a.slice(nombre.length + 3) : def;
}

function leerJson(ruta: string, que: string): unknown {
  let texto: string;
  try {
    texto = readFileSync(ruta, "utf8");
  } catch {
    throw new Error(`No se pudo leer ${que}: ${ruta}`);
  }
  try {
    return JSON.parse(texto);
  } catch {
    // El mensaje de JSON.parse cita un fragmento del contenido: no se reenvía.
    throw new Error(`${que} no es un JSON válido: ${ruta}`);
  }
}

const esLista = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function main() {
  const argv = process.argv.slice(2);
  const rutaPropuestas = arg(argv, "propuestas", "tmp/busqueda/banco-propuestas.local.json");
  const rutaConsultas = arg(argv, "consultas", "tmp/busqueda/consultas-reales.local.json");
  const salida = resolverSalida(arg(argv, "salida", "tmp/busqueda/banco-real.local.json"), { estricto: true });

  const propuestas = leerJson(rutaPropuestas, "el archivo de propuestas");
  const deLasPropuestas = (propuestas as { categorias?: unknown } | null)?.categorias;
  const categorias = esLista(deLasPropuestas) ? deLasPropuestas : (leerJson(rutaConsultas, "el archivo de consultas") as { categorias?: unknown }).categorias;
  if (!esLista(categorias) || !categorias.length) {
    throw new Error("No hay árbol de categorías para validar: las propuestas o el archivo de consultas deben traer `categorias`.");
  }

  const { banco, resumen } = compilarBancoReal(propuestas, categorias);
  mkdirSync(dirname(salida.ruta), { recursive: true });
  writeFileSync(salida.ruta, `${JSON.stringify(banco, null, 2)}\n`);
  console.log(textoCompilacion(resumen));
  console.log(`Banco real (${banco.busquedas.length} casos, ignorado por git): ${salida.ruta}`);
  console.log("Cárguelo con: npm run banco:busqueda -- --banco=<esa ruta>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`[compilar-banco] ${err instanceof Error ? err.message : "error desconocido"}`);
    process.exit(1);
  }
}
