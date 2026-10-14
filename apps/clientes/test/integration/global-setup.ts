import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { TEST_DATABASE_URL, ADMIN_DATABASE_URL, assertLocalTestDb } from "./db-url";

// globalSetup del proyecto "integration" (corre UNA vez): crea la DB local de test si falta y
// aplica las migraciones REALES de las dos apps, en el mismo orden que en prod:
//   1. `public` → apps/admin/drizzle (el CRM es dueño del esquema; incluye la vista
//      `catalog_products_shop` que lee el Shop).
//   2. `shop`   → apps/clientes/drizzle, con el bookkeeping propio `shop.__drizzle_migrations`.
// Las rutas salen de import.meta.url, no del cwd.
//
// GOTCHA: si una baseline se regenera, una base de test que ya la tenía conserva la forma vieja.
// Se arregla una vez, solo en la local:  dropdb shop_test
// Parche de test, mientras la rama no tenga la migración 0087 del CRM (`catalog_overlay.oculta_en_tienda`,
// que lee el Shop en `activoSql`): se agrega la columna con este comentario de marca. Antes de migrar se
// quita si ya está marcada, para que la 0087 real (un ADD COLUMN sin IF NOT EXISTS) no choque en una
// base que ya tenía el parche; con la 0087 aplicada la columna existe sin marca y no se toca nada.
const MARCA_PARCHE_OCULTA = "parche-test-shop: reemplazar por la migracion 0087 del CRM";

export default async function setup() {
  assertLocalTestDb(TEST_DATABASE_URL);
  const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");

  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    // La crea el proveedor en prod; CREATE EXTENSION pide superusuario.
    await client.unsafe("CREATE EXTENSION IF NOT EXISTS unaccent");
    const [marcada] = await client`
      select exists (
        select 1 from pg_attribute a
        where a.attrelid = to_regclass('public.catalog_overlay') and a.attname = 'oculta_en_tienda' and not a.attisdropped
          and col_description(a.attrelid, a.attnum) = ${MARCA_PARCHE_OCULTA}
      ) as marcada`;
    if (marcada.marcada) await client.unsafe('ALTER TABLE "public"."catalog_overlay" DROP COLUMN "oculta_en_tienda"');
    const crm = fileURLToPath(new URL("../../../admin/drizzle", import.meta.url));
    await migrate(drizzle(client), { migrationsFolder: crm });
    const shop = fileURLToPath(new URL("../../drizzle", import.meta.url));
    await migrate(drizzle(client), { migrationsFolder: shop, migrationsSchema: "shop" });
    const [tiene] = await client`
      select exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'catalog_overlay' and column_name = 'oculta_en_tienda') as tiene`;
    if (!tiene.tiene) {
      await client.unsafe('ALTER TABLE "public"."catalog_overlay" ADD COLUMN "oculta_en_tienda" boolean NOT NULL DEFAULT false');
      await client.unsafe(`COMMENT ON COLUMN "public"."catalog_overlay"."oculta_en_tienda" IS '${MARCA_PARCHE_OCULTA}'`);
    }
  } finally {
    await client.end();
  }
}
