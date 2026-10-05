/**
 * `npm run busqueda:cobertura` — cobertura de atributos técnicos del catálogo,
 * SOLO LECTURA contra la base de `.env.local` (una transacción `read only` con
 * rol shop_app, a lo sumo tres SELECT, sin escrituras ni migraciones).
 *
 *   npm run busqueda:cobertura
 *   npm run busqueda:cobertura -- --json=tmp/busqueda/cobertura.json
 *   npm run busqueda:cobertura -- --universo=activos --tenant-alias=demo
 *
 * Flags:
 *   --universo=publicados|activos   denominador: publicados con stock (por defecto) o activos con stock
 *   --json=<ruta>  (alias --salida) reporte JSON; use una ruta ignorada por git (tmp/…): se avisa si no lo está
 *   --tenant-alias=<alias>          cómo se nombra al tenant en la cabecera (por defecto "shop"; nunca el id real)
 *
 * El reporte sólo trae categorías, claves y conteos: se puede pegar en un PR.
 * Nunca imprime variables de entorno, cadenas de conexión ni ids de tenant.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crmAtributos } from "@/db/crm";
import { cargarFilasUniverso } from "@/lib/busqueda-v2/__banco__/universo";
import { cerrar, enLectura } from "@/lib/busqueda-v2/__banco__/lectura";
import { gitInfo } from "@/lib/busqueda-v2/__banco__/corrida";
import { resolverSalida } from "@/lib/busqueda-v2/__banco__/ruta-salida";
import { getArbolCategorias } from "@/lib/catalog";
import { shopTenantId } from "@/lib/tenant";
import { generarCobertura, parsearArgsCobertura, type ArgsCobertura, type DatosCobertura } from "./cobertura";

/** Tope de cada sentencia: la cobertura son ~3 lecturas de miles de filas, nunca debería acercarse. */
const TIMEOUT_SENTENCIA_MS = 60_000;

/** Lo único que se muestra de un error: nunca el mensaje de la base (puede traer host, usuario o la cadena de conexión). */
function motivoSeguro(err: unknown): string {
  if (err instanceof Error && /^Falta [A-Z_]+ en el entorno/.test(err.message)) return err.message;
  const nombre = err instanceof Error ? err.name : "error";
  const codigo = typeof (err as { code?: unknown } | null)?.code === "string" ? ` ${(err as { code: string }).code}` : "";
  return `${nombre}${codigo}`;
}

/** Los tres SELECT, dentro de UNA transacción read only. Los atributos van al final y en un savepoint: si la tabla no está, el resto sigue válido. */
async function leer(): Promise<DatosCobertura> {
  return enLectura(async () => {
    // SET no admite parámetros enlazados: el valor es una constante numérica propia.
    await getDb().execute(sql.raw(`set local statement_timeout = ${TIMEOUT_SENTENCIA_MS}`));
    const filas = await cargarFilasUniverso();
    const arbol = await getArbolCategorias();
    const atributos: DatosCobertura["atributos"] = await getDb()
      .transaction((t) =>
        t
          .select({ alegraId: crmAtributos.alegraId, clave: crmAtributos.clave, valorNum: crmAtributos.valorNum, valorTexto: crmAtributos.valorTexto })
          .from(crmAtributos)
          // Sin `fuente`: la columna no está concedida al rol del Shop.
          .where(eq(crmAtributos.tenantId, shopTenantId())),
      )
      .catch((err: unknown) => ({ no_disponible: `no se pudo leer catalog_atributos (${motivoSeguro(err)})` }));
    return { filas, arbol, atributos };
  });
}

/** La conexión sólo se cierra si se llegó a abrir (un argumento inválido no la toca). */
let conexionAbierta = false;

async function main(args: ArgsCobertura) {
  conexionAbierta = true;
  const { json, texto } = await generarCobertura(args, { leer, git: () => gitInfo() });
  console.log(texto);
  if (args.json) {
    const { ruta, advertencia } = resolverSalida(args.json, { estricto: false });
    if (advertencia) console.warn(advertencia);
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, `${JSON.stringify(json, null, 2)}\n`);
    console.error(`[cobertura] JSON escrito en ${ruta}`);
  }
  if ("no_disponible" in json.cobertura) process.exitCode = 1;
}

let args: ArgsCobertura;
try {
  args = parsearArgsCobertura(process.argv.slice(2));
} catch (err) {
  // Argumento inválido: se informa y se sale sin abrir ninguna conexión.
  console.error(`[cobertura] ${err instanceof Error ? err.message : "argumentos inválidos"}`);
  process.exit(1);
}

main(args)
  .catch((err: unknown) => {
    console.error(`[cobertura] ${motivoSeguro(err)}`);
    process.exitCode = 1;
  })
  .finally(() => (conexionAbierta ? cerrar().catch(() => undefined) : undefined));
