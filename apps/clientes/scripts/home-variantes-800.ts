/**
 * Backfill de las imágenes de la home a la ruta con variantes (800 y 1600).
 *
 *   npm run home:variantes            # DRY-RUN: sólo informa qué haría
 *   npm run home:variantes -- --ejecutar
 *
 * Qué hace, para el tenant de SHOP_TENANT_ID:
 *   1. Lee todas las filas de `shop.home_content` del tenant y junta las URLs
 *      viejas (`…/home/{tenant}/{uuid}-1600.webp`) que aparecen en el payload.
 *   2. Por cada una: baja la 1600 vieja del bucket, la copia tal cual a
 *      `home/{tenant}/v/{uuid}-1600.webp` y genera con sharp la de 800 en
 *      `home/{tenant}/v/{uuid}-800.webp` (sin agrandar: si mide menos de 800,
 *      queda al tamaño real). Lo que ya existe en la ruta nueva se saltea.
 *   3. Sólo si TODAS las copias de una fila salieron bien, reescribe el
 *      payload de esa fila con las URLs nuevas (UPDATE condicionado al payload
 *      leído: si alguien editó la home en el medio, no pisa y lo informa).
 *
 * Los objetos viejos NO se borran: las URLs viejas siguen andando (por eso el
 * orden es objetos → base) y el script se puede repetir (idempotente).
 * Después de ejecutar, la home cacheada tarda en refrescarse; guardar
 * cualquier sección desde el editor invalida el tag `home`.
 *
 * Entorno (lee .env.local si existe): DATABASE_URL, SHOP_TENANT_ID,
 * R2_SHOP_MEDIA_* (ver src/lib/shop-media.ts). Una base que no es local exige
 * BACKFILL_CONFIRM=<host>. Imprime sólo cantidades y keys, nunca credenciales.
 */
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import {
  keyHomeNueva,
  keyHomeVieja,
  reescribirUrlsHome,
  type PartesHomeVieja,
} from "../src/lib/home-variantes";
import type { R2Client } from "../src/lib/r2";

const HOSTS_LOCALES = ["localhost", "127.0.0.1", "::1"];
const MAX_BYTES_ORIGINAL = 10 * 1024 * 1024;
const CALIDAD_WEBP = 82;

export interface Conteo {
  filas: number;
  filasConCambios: number;
  filasActualizadas: number;
  filasConflicto: number;
  filasConError: number;
  imagenes: number;
  copiadas1600: number;
  generadas800: number;
  yaExistian: number;
  faltanEnBucket: number;
}

export const conteoVacio = (): Conteo => ({
  filas: 0,
  filasConCambios: 0,
  filasActualizadas: 0,
  filasConflicto: 0,
  filasConError: 0,
  imagenes: 0,
  copiadas1600: 0,
  generadas800: 0,
  yaExistian: 0,
  faltanEnBucket: 0,
});

type Redimensionar = (original: Uint8Array) => Promise<Uint8Array>;

/** Redimensiona a 800 de ancho sin agrandar (misma regla que el editor). */
export async function redimensionarA800(original: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const buf = await sharp(original)
    .rotate()
    .resize({ width: 800, withoutEnlargement: true })
    .webp({ quality: CALIDAD_WEBP })
    .toBuffer();
  return new Uint8Array(buf);
}

/**
 * Asegura que existan `v/{uuid}-1600` y `v/{uuid}-800` para una imagen vieja.
 * Devuelve false si la original no está en el bucket (la fila no se reescribe).
 * Con `ejecutar=false` sólo cuenta.
 */
export async function migrarImagen(
  r2: Pick<R2Client, "head" | "getObject" | "put">,
  p: PartesHomeVieja,
  c: Conteo,
  { ejecutar, redimensionar = redimensionarA800 }: { ejecutar: boolean; redimensionar?: Redimensionar },
): Promise<boolean> {
  const nueva1600 = keyHomeNueva(p, 1600);
  const nueva800 = keyHomeNueva(p, 800);
  const [tiene1600, tiene800] = await Promise.all([r2.head(nueva1600), r2.head(nueva800)]);
  if (tiene1600 && tiene800) {
    c.yaExistian += 1;
    return true;
  }

  const original = await r2.getObject(keyHomeVieja(p), { maxBytes: MAX_BYTES_ORIGINAL });
  if (!original) {
    c.faltanEnBucket += 1;
    return false;
  }

  if (!tiene1600) {
    if (ejecutar) await r2.put(nueva1600, original, { contentType: "image/webp" });
    c.copiadas1600 += 1;
  }
  if (!tiene800) {
    if (ejecutar) await r2.put(nueva800, await redimensionar(original), { contentType: "image/webp" });
    c.generadas800 += 1;
  }
  return true;
}

type Fila = { key: string; payload: unknown };

export interface Deps {
  r2: Pick<R2Client, "head" | "getObject" | "put">;
  leerFilas: () => Promise<Fila[]>;
  /** UPDATE condicionado: devuelve false si el payload cambió desde que se leyó. */
  actualizarFila: (key: string, viejo: unknown, nuevo: unknown) => Promise<boolean>;
  redimensionar?: Redimensionar;
}

/** Orquesta todo; sin I/O propio, así que se testea con dobles. */
export async function correr(deps: Deps, ejecutar: boolean, log: (s: string) => void = console.log): Promise<Conteo> {
  const c = conteoVacio();
  const hechas = new Map<string, boolean>();

  for (const fila of await deps.leerFilas()) {
    c.filas += 1;
    const vistas: PartesHomeVieja[] = [];
    const { valor, cambios } = reescribirUrlsHome(fila.payload, (p) => vistas.push(p));
    if (cambios === 0) continue;
    c.filasConCambios += 1;

    let todoOk = true;
    for (const p of vistas) {
      const id = `${p.tenant}/${p.id}`;
      let ok = hechas.get(id);
      if (ok === undefined) {
        c.imagenes += 1;
        try {
          ok = await migrarImagen(deps.r2, p, c, { ejecutar, redimensionar: deps.redimensionar });
        } catch (err) {
          log(`  error con ${id}: ${err instanceof Error ? err.name : "error"}`);
          ok = false;
        }
        hechas.set(id, ok);
      }
      if (!ok) todoOk = false;
    }

    if (!todoOk) {
      c.filasConError += 1;
      log(`  fila ${fila.key}: no se reescribe (falta alguna imagen o falló una copia)`);
      continue;
    }
    if (!ejecutar) continue;
    if (await deps.actualizarFila(fila.key, fila.payload, valor)) c.filasActualizadas += 1;
    else {
      c.filasConflicto += 1;
      log(`  fila ${fila.key}: cambió mientras corría el script; se saltea (vuelva a correrlo)`);
    }
  }
  return c;
}

export function resumen(c: Conteo, ejecutar: boolean): string {
  return [
    ejecutar ? "EJECUTADO" : "DRY-RUN (no escribe)",
    `filas ${c.filas} (con URLs viejas ${c.filasConCambios})`,
    `imágenes ${c.imagenes} · ya migradas ${c.yaExistian} · 1600 a copiar ${c.copiadas1600} · 800 a generar ${c.generadas800} · faltan en el bucket ${c.faltanEnBucket}`,
    `filas reescritas ${c.filasActualizadas} · en conflicto ${c.filasConflicto} · sin reescribir por error ${c.filasConError}`,
  ].join("\n");
}

async function main() {
  const ejecutar = process.argv.includes("--ejecutar");
  const env = process.env;
  for (const v of ["DATABASE_URL", "SHOP_TENANT_ID"]) {
    if (!env[v]?.trim()) {
      console.error(`Falta ${v} en el entorno.`);
      process.exit(1);
    }
  }
  let host: string;
  try {
    host = new URL(env.DATABASE_URL!.trim()).hostname;
  } catch {
    console.error("DATABASE_URL no es una URL de Postgres válida.");
    process.exit(1);
  }
  if (!HOSTS_LOCALES.includes(host) && env.BACKFILL_CONFIRM?.trim() !== host) {
    console.error(`La base no es local (host ${host}). Para correr contra ella, use BACKFILL_CONFIRM=${host}.`);
    process.exit(1);
  }
  const tenant = env.SHOP_TENANT_ID!.trim();

  const { shopMediaConfig } = await import("../src/lib/shop-media");
  const { createR2 } = await import("../src/lib/r2");
  const cfg = shopMediaConfig(env);
  if (!cfg) {
    console.error("Falta la config del bucket de medios (R2_SHOP_MEDIA_*).");
    process.exit(1);
  }
  const r2 = createR2(cfg);

  console.log(`home variantes · base ${host} · tenant ${tenant} · bucket ${cfg.bucket}${ejecutar ? "" : " · DRY-RUN"}`);

  const { getDb } = await import("../src/db");
  const db = getDb();
  try {
    const c = await correr(
      {
        r2,
        leerFilas: async () =>
          (await db.execute(
            sql`select key, payload from shop.home_content where tenant_id = ${tenant} order by key`,
          )) as unknown as Fila[],
        actualizarFila: async (key, viejo, nuevo) => {
          const res = (await db.execute(
            sql`update shop.home_content set payload = ${JSON.stringify(nuevo)}::jsonb, updated_at = now()
                where tenant_id = ${tenant} and key = ${key} and payload = ${JSON.stringify(viejo)}::jsonb
                returning key`,
          )) as unknown as unknown[];
          return res.length > 0;
        },
      },
      ejecutar,
    );
    console.log(resumen(c, ejecutar));
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`home variantes falló: ${err instanceof Error ? err.name : "error"}`);
    process.exit(1);
  });
}
