/**
 * `npm run busqueda:extraer` — extrae las consultas reales de la caché de
 * interpretaciones (`shop.busqueda_interpretaciones`) a un archivo LOCAL
 * ignorado por git, para armar el banco real de la línea base de búsqueda
 * (slice B). SOLO lectura: un único SELECT agregado dentro de una transacción
 * `read only` (con `statement_timeout`), filtrado por el tenant del Shop.
 *
 * Paso manual (lo corre la usuaria, parada en apps/clientes, con `npm ci`
 * hecho y `.env.local` apuntando a la base que se quiere medir):
 *
 *   npm run busqueda:extraer
 *   npm run busqueda:extraer -- --top=150 --cola=50 --semilla=1
 *
 * Flags: `--top=N` consultas más usadas (150), `--cola=N` muestra sembrada del
 * resto (50), `--semilla=N` (1; misma semilla => mismo conjunto),
 * `--salida=<ruta>` (por defecto tmp/busqueda/consultas-reales.local.json),
 * `--ver-consultas` (imprime las consultas en la consola: sólo uso local).
 *
 * Privacidad (repo público):
 *  - La ruta de salida DEBE estar ignorada por git (o fuera del repo): si no,
 *    aborta ANTES de abrir la conexión.
 *  - La consola sólo muestra conteos, la ruta, la duración y el resumen
 *    agregado de la población (pegue ESE resumen, nunca el archivo). Nunca
 *    imprime consultas (salvo `--ver-consultas`), variables de entorno, el id
 *    del tenant ni la cadena de conexión.
 *  - Se excluyen las consultas que parecen datos personales, las vacías y las
 *    de más de 120 caracteres.
 *
 * Después: un subagente propone etiquetas leyendo SÓLO ese archivo (paso U5) y
 * `npm run busqueda:compilar-banco` arma el banco real (paso U6).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { busquedaInterpretaciones as bi } from "@/db/schema";
import { getArbolCategorias } from "@/lib/catalog";
import { shopTenantId } from "@/lib/tenant";
import { cerrar, enLectura } from "@/lib/busqueda-v2/__banco__/lectura";
import { resolverSalida } from "@/lib/busqueda-v2/__banco__/ruta-salida";
import {
  armarArchivo,
  desdeFila,
  filtrarPersonales,
  mensajeSeguro,
  muestrear,
  parsearArgsExtraccion,
  resumirPoblacion,
  textoConsola,
  type FilaAgregada,
} from "./consultas-reales";

/** Tope de la sentencia: la tabla es chica, pero la transacción no debe quedar abierta indefinidamente. */
const TIMEOUT_MS = 60_000;

let conexionAbierta = false;

async function leer() {
  getDb(); // sin DATABASE_URL falla acá, antes de marcar la conexión como abierta
  conexionAbierta = true;
  return enLectura(async () => {
    const db = getDb();
    await db.execute(sql.raw(`set local statement_timeout = ${TIMEOUT_MS}`));
    const filas: FilaAgregada[] = await db
      .select({
        consulta: bi.consultaNorm,
        hits: sql<number>`sum(${bi.hits})::int`,
        primera: sql<string>`min(${bi.createdAt})::text`,
        ultima: sql<string>`max(${bi.lastUsedAt})::text`,
        fuentes: sql<string>`string_agg(distinct ${bi.fuente}, ',')`,
        intencion: sql<string | null>`max(${bi.resultado}->>'intencion')`,
      })
      .from(bi)
      .where(eq(bi.tenantId, shopTenantId()))
      .groupBy(bi.consultaNorm)
      .orderBy(sql`sum(${bi.hits}) desc`, bi.consultaNorm);
    const arbol = await getArbolCategorias();
    return { filas, categorias: [...new Set(arbol.map((n) => n.nombre))].sort() };
  });
}

async function main(args: ReturnType<typeof parsearArgsExtraccion>) {
  const inicio = Date.now();
  // Antes de tocar la base: una ruta no ignorada por git aborta acá.
  const salida = resolverSalida(args.salida, { estricto: true });

  const { filas, categorias } = await leer();
  const { validas, excluidas } = filtrarPersonales(filas.map(desdeFila));
  const muestra = muestrear(validas, { top: args.top, cola: args.cola, semilla: args.semilla });
  const resumen = resumirPoblacion(validas, excluidas);

  mkdirSync(dirname(salida.ruta), { recursive: true });
  writeFileSync(salida.ruta, `${JSON.stringify(armarArchivo({ extraidoEl: new Date().toISOString(), categorias, muestra, resumen }), null, 2)}\n`);

  console.log(textoConsola({ resumen, muestra, ruta: salida.ruta, ms: Date.now() - inicio }));
  if (args.verConsultas) for (const c of muestra.seleccion) console.log(`  ${c.hits}\t${c.consulta}`);
}

let args: ReturnType<typeof parsearArgsExtraccion>;
try {
  args = parsearArgsExtraccion(process.argv.slice(2));
} catch (err) {
  // Argumento inválido: el mensaje es propio (no trae valores del entorno).
  console.error(`[extraer] ${err instanceof Error ? err.message : "argumentos inválidos"}`);
  process.exit(1);
}

main(args)
  .catch((err: unknown) => {
    // Los errores del driver pueden citar la cadena de conexión: sólo el tipo y el código.
    console.error(`[extraer] ${err instanceof Error && /^Salida rechazada/.test(err.message) ? err.message : mensajeSeguro(err)}`);
    process.exitCode = 1;
  })
  .finally(() => (conexionAbierta ? cerrar() : undefined));
