/**
 * Reglas de `db:migrate` que NO necesitan una base: de dónde sale la URL, qué
 * se imprime del destino y qué rol puede migrar.
 *
 * Viven aparte de `migrate.ts` porque ese archivo abre una conexión apenas se
 * ejecuta, y estas reglas son justamente las que evitan migrar la base
 * equivocada: tienen que poder testearse sin conectarse a nada.
 */

/** Rol con el que corre la app. Tiene DML sobre `shop` y nada más. */
const ROL_DE_RUNTIME = "shop_app";

type Entorno = Record<string, string | undefined>;

export type DestinoMigracion = {
  /** Connection string completa. Lleva la clave: NUNCA se imprime. */
  url: string;
  host: string;
};

/**
 * La URL de migración sale de UNA sola variable, sin cadena de fallbacks.
 *
 * Antes se leía `POSTGRES_URL_NON_POOLING ?? DATABASE_URL ?? POSTGRES_URL`: con
 * eso, la base que terminaba migrada dependía de qué variables hubiera sueltas
 * en el entorno. Ahora que el Shop comparte base con el CRM, equivocarse de
 * destino es tocar la base de otro producto, así que se exige nombrarlo.
 */
export function leerUrlMigracion(env: Entorno): DestinoMigracion {
  const url = env.MIGRATE_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Falta MIGRATE_DATABASE_URL. Las migraciones del Shop usan SOLO esa variable (conexión directa, rol dueño). No se usa DATABASE_URL ni POSTGRES_URL*."
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    // Sin el error original ni la URL: cualquiera de los dos puede traer la clave.
    throw new Error(
      "MIGRATE_DATABASE_URL no es una URL de Postgres válida (postgres://rol:clave@host:puerto/base)."
    );
  }

  // El DDL va por la conexión directa. Por el pooler (pgbouncer en modo
  // transacción) los locks y el estado de sesión de una migración no se sostienen.
  if (host.includes("-pooler")) {
    throw new Error(
      'MIGRATE_DATABASE_URL apunta al pooler. Use la conexión directa (sin "-pooler").'
    );
  }

  return { url, host };
}

/**
 * Lo que se imprime ANTES de aplicar nada, para que quien corre el comando vea
 * a dónde le está pegando. `base` y `rol` salen de la conexión
 * (`current_database()`, `current_user`) y no de la URL: es lo que el servidor
 * dice que somos. Ni la clave ni la URL completa aparecen jamás.
 */
export function bannerDestino(destino: {
  host: string;
  base: string;
  rol: string;
}): string {
  return `[db:migrate] destino → host=${destino.host} base=${destino.base} rol=${destino.rol} esquema=shop tabla=shop.__drizzle_migrations`;
}

/**
 * ¿Es un rol que no debe migrar? El migrador de drizzle arranca con un
 * `CREATE SCHEMA IF NOT EXISTS`, que Postgres rechaza sin CREATE sobre la base
 * aunque el esquema ya exista: fallaría igual, pero con un error de permisos
 * que no dice qué hacer. Esto lo vuelve legible.
 */
export function esRolDeRuntime(rol: string, puedeCrear: boolean): boolean {
  return rol === ROL_DE_RUNTIME || !puedeCrear;
}

export function mensajeRolDeRuntime(rol: string): string {
  return `El rol "${rol}" es de runtime y no puede migrar. Use el rol dueño.`;
}
