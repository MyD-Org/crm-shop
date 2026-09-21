import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { TEST_DATABASE_URL, ADMIN_DATABASE_URL, assertLocalTestDb } from "./db-url"

// globalSetup de los tests de integración (corre UNA vez): asegura que exista la DB de test
// y le aplica todas las migraciones de drizzle. Así el `npm run test:integration` se
// bootstrapea solo, sin pasos manuales.
export default async function setup() {
  assertLocalTestDb(TEST_DATABASE_URL)

  const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "")

  // 1. Crear la DB de test si no existe (conectando a la base "postgres").
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 })
  try {
    const exists = await admin`select 1 from pg_database where datname = ${dbName}`
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${dbName}"`)
  } finally {
    await admin.end()
  }

  // 2. Extensiones que prod ya tiene y las migraciones no crean (las crea el proveedor, y
  //    CREATE EXTENSION pide superusuario). `unaccent` la usan las búsquedas por texto del
  //    catálogo: sin esto los tests que las tocan fallan con "function unaccent does not exist"
  //    aunque el código sea correcto.
  const client = postgres(TEST_DATABASE_URL, { max: 1 })
  try {
    await client.unsafe("CREATE EXTENSION IF NOT EXISTS unaccent")
    // 3. Aplicar migraciones sobre la DB de test.
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" })

    // 4. Esquema `shop`: se aplican las migraciones REALES del Shop (apps/clientes/drizzle),
    //    no un fixture armado a mano. El CRM lee y escribe `shop.orders`, así que los tests
    //    tienen que correr contra lo mismo que corre en prod; y como el CI del Shop no tiene
    //    base, esta es la ÚNICA corrida automática que aplica esa baseline a un Postgres real.
    //
    //    - Se usa el migrador del drizzle-orm del CRM: sólo lee `meta/_journal.json` y los
    //      `.sql` (archivos planos), sin tocar `apps/clientes/node_modules`.
    //    - `migrationsSchema: "shop"` es el mismo bookkeeping que usa el Shop
    //      (`shop.__drizzle_migrations`); el del CRM (`drizzle.__drizzle_migrations`) ni se
    //      entera. Sin esto, el migrador compararía contra la última migración del CRM y
    //      saltearía la baseline.
    //    - La ruta sale de `import.meta.url`, no del cwd.
    //
    //    GOTCHA local: si la baseline del Shop se REGENERA, una `crm_test` que ya la tenía
    //    aplicada conserva la forma vieja (el migrador sólo mira `created_at`, no el hash).
    //    Se arregla una vez, y SÓLO en la base local de test:
    //      psql -h localhost -d crm_test -c 'DROP SCHEMA IF EXISTS shop CASCADE'
    const shopMigrations = fileURLToPath(new URL("../../../clientes/drizzle", import.meta.url))
    await migrate(drizzle(client), { migrationsFolder: shopMigrations, migrationsSchema: "shop" })
  } finally {
    await client.end()
  }
}
