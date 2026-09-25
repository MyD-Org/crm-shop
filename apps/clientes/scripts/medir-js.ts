/**
 * Peso del JS de primera carga por ruta, en KB gzip.
 *
 *   npm run build && npm run medir:js
 *
 * Lee sólo `.next/` (sin red ni variables de entorno). Por cada
 * `.next/server/app/**\/page_client-reference-manifest.js` junta los chunks de
 * entrada de la ruta (`entryJSFiles` de todos sus segmentos: layouts + página)
 * y les suma los chunks raíz de `.next/build-manifest.json` (`rootMainFiles`),
 * que se cargan en todas las rutas. Cada chunk se cuenta una sola vez por ruta.
 * No incluye lo que se baja de CDNs externos (p. ej. clerk-js) ni los chunks
 * que se piden después de cargar (imports dinámicos).
 *
 * Imprime una tabla markdown `ruta | KB gz` ordenada de mayor a menor y, abajo,
 * qué rutas cargan dependencias pesadas que no deberían estar ahí ("marcas").
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";

export type ManifiestoRsc = { entryJSFiles?: Record<string, string[]> };

export type BuildManifest = { rootMainFiles?: string[] };

export type MedicionRuta = { ruta: string; chunks: string[]; bytesGz: number };

/**
 * Dependencias que buscamos por texto en los chunks de cada ruta. El patrón
 * apunta a nombres de clase CSS que cada librería deja como string literal y
 * que sobreviven a la minificación.
 */
export const MARCAS: Record<string, RegExp> = {
  recharts: /recharts-/,
  "react-day-picker": /\brdp-/,
};

/**
 * "/catalogo/page" → "/catalogo"; "/page" → "/"; los grupos "(x)" no forman
 * parte de la URL. Devuelve null para lo que no es una ruta navegable
 * (internas de Next como "/_not-found" y slots paralelos "@x").
 */
export function rutaDesdeClave(clave: string): string | null {
  const segmentos = clave
    .replace(/\/page$/, "")
    .split("/")
    .filter((s) => s !== "" && !/^\(.*\)$/.test(s));
  if (segmentos.some((s) => s.startsWith("_") || s.startsWith("@"))) return null;
  return "/" + segmentos.join("/");
}

/** Chunks de primera carga de una ruta, sin duplicados y en orden estable. */
export function chunksDeRuta(
  manifiesto: ManifiestoRsc,
  buildManifest: BuildManifest,
): string[] {
  const todos = [
    ...(buildManifest.rootMainFiles ?? []),
    ...Object.values(manifiesto.entryJSFiles ?? {}).flat(),
  ];
  return [...new Set(todos.filter((c) => c.endsWith(".js")))].sort();
}

/** Evalúa el `.js` del manifiesto (asigna `globalThis.__RSC_MANIFEST[clave]`). */
export function leerManifiestoRsc(codigo: string): Record<string, ManifiestoRsc> {
  const contexto: { __RSC_MANIFEST?: Record<string, ManifiestoRsc> } = {};
  runInNewContext(codigo, { globalThis: contexto, self: contexto });
  return contexto.__RSC_MANIFEST ?? {};
}

export function kb(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

export function formatearTabla(mediciones: MedicionRuta[]): string {
  const filas = [...mediciones]
    .sort((a, b) => b.bytesGz - a.bytesGz || a.ruta.localeCompare(b.ruta))
    .map((m) => `| \`${m.ruta}\` | ${kb(m.bytesGz)} |`);
  return ["| ruta | KB gz |", "| --- | ---: |", ...filas].join("\n");
}

export function formatearMarcas(
  rutasPorMarca: Record<string, string[]>,
): string {
  return Object.entries(rutasPorMarca)
    .map(([marca, rutas]) =>
      rutas.length === 0
        ? `- \`${marca}\`: ninguna ruta`
        : `- \`${marca}\`: ${[...rutas].sort().map((r) => `\`${r}\``).join(", ")}`,
    )
    .join("\n");
}

function buscarManifiestos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...buscarManifiestos(ruta));
    else if (nombre === "page_client-reference-manifest.js") salida.push(ruta);
  }
  return salida;
}

function main() {
  const dirNext = join(process.cwd(), ".next");
  const dirApp = join(dirNext, "server", "app");
  const rutaBuildManifest = join(dirNext, "build-manifest.json");
  if (!existsSync(dirApp) || !existsSync(rutaBuildManifest)) {
    console.error("No se encontró .next/. Ejecute npm run build antes.");
    process.exit(1);
  }

  const buildManifest = JSON.parse(
    readFileSync(rutaBuildManifest, "utf8"),
  ) as BuildManifest;

  // Un chunk se comparte entre muchas rutas: se lee y comprime una sola vez.
  const cache = new Map<string, { gz: number; texto: string }>();
  const chunk = (archivo: string) => {
    let c = cache.get(archivo);
    if (!c) {
      const buffer = readFileSync(join(dirNext, archivo));
      c = { gz: gzipSync(buffer, { level: 9 }).length, texto: buffer.toString("utf8") };
      cache.set(archivo, c);
    }
    return c;
  };

  const mediciones: MedicionRuta[] = [];
  for (const archivo of buscarManifiestos(dirApp)) {
    const manifiestos = leerManifiestoRsc(readFileSync(archivo, "utf8"));
    for (const [clave, manifiesto] of Object.entries(manifiestos)) {
      const ruta = rutaDesdeClave(clave);
      if (ruta === null) continue;
      const chunks = chunksDeRuta(manifiesto, buildManifest);
      const bytesGz = chunks.reduce((total, c) => total + chunk(c).gz, 0);
      mediciones.push({ ruta, chunks, bytesGz });
    }
  }

  if (mediciones.length === 0) {
    console.error(
      `No hay manifiestos de rutas en ${relative(process.cwd(), dirApp).split(sep).join("/")}. Ejecute npm run build antes.`,
    );
    process.exit(1);
  }

  const rutasPorMarca = Object.fromEntries(
    Object.entries(MARCAS).map(([marca, patron]) => [
      marca,
      mediciones
        .filter((m) => m.chunks.some((c) => patron.test(chunk(c).texto)))
        .map((m) => m.ruta),
    ]),
  );

  console.log("## JS de primera carga por ruta (gzip)\n");
  console.log(formatearTabla(mediciones));
  console.log("\n## Marcas\n");
  console.log(formatearMarcas(rutasPorMarca));
}

if (process.argv[1]?.endsWith("medir-js.ts")) main();
