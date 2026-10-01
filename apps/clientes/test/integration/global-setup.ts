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
export default async function setup() {
  assertLocalTestDb(TEST_DATABASE_URL);
  const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");

  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  try {
    const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  const client = postgres(TEST_DATABASE_URL, { max: 1 });
  try {
    // La crea el proveedor en prod; CREATE EXTENSION pide superusuario.
    await client.unsafe("CREATE EXTENSION IF NOT EXISTS unaccent");
    const crm = fileURLToPath(new URL("../../../admin/drizzle", import.meta.url));
    await migrate(drizzle(client), { migrationsFolder: crm });
    const shop = fileURLToPath(new URL("../../drizzle", import.meta.url));
    await migrate(drizzle(client), { migrationsFolder: shop, migrationsSchema: "shop" });
  } finally {
    await client.end();
  }
}
