import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import {
  TEMPLATE_DATABASE_URL,
  ADMIN_DATABASE_URL,
  TEST_WORKERS,
  workerDatabaseUrl,
  assertLocalTestDb,
} from "./db-url"

// Roles que los tests de permisos usan con SET LOCAL ROLE. Los roles son del SERVIDOR, no de
// una base: si cada archivo los creara y borrara, dos workers en paralelo se pisarían. Se crean
// acá una vez (después de migrar la plantilla, para que las migraciones corran sin el rol, como
// antes) y los tests los encuentran ya creados, así que no los borran.
const ROLES_DE_TEST = ["shop_app", "crm_test_sin_execute", "crm_test_sin_execute_sc"]

const nombreBase = (url: string) => new URL(url).pathname.replace(/^\//, "")

// globalSetup de los tests de integración (corre UNA vez): asegura que exista la DB plantilla,
// le aplica todas las migraciones de drizzle y la clona una vez por worker. Así el
// `npm run test:integration` se bootstrapea solo, sin pasos manuales.
export default async function setup() {
  assertLocalTestDb(TEMPLATE_DATABASE_URL)

  const dbName = nombreBase(TEMPLATE_DATABASE_URL)

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
  const client = postgres(TEMPLATE_DATABASE_URL, { max: 1 })
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

  // 5. Roles compartidos y un clon de la plantilla por worker. CREATE DATABASE ... TEMPLATE
  //    exige que nadie esté conectado a la plantilla (cerrar un psql abierto contra crm_test).
  //    WITH (FORCE) corta conexiones colgadas de una corrida anterior a los clones.
  const rolesCreados: string[] = []
  const clones = Array.from({ length: TEST_WORKERS }, (_, i) => workerDatabaseUrl(i + 1))
  const server = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    for (const rol of ROLES_DE_TEST) {
      const existe = await server`select 1 from pg_roles where rolname = ${rol}`
      if (existe.length === 0) {
        await server.unsafe(`CREATE ROLE "${rol}" NOLOGIN`)
        rolesCreados.push(rol)
      }
    }
    for (const url of clones) {
      assertLocalTestDb(url)
      await server.unsafe(`DROP DATABASE IF EXISTS "${nombreBase(url)}" WITH (FORCE)`)
      await server.unsafe(`CREATE DATABASE "${nombreBase(url)}" TEMPLATE "${dbName}"`)
    }
  } finally {
    await server.end()
  }

  // Teardown: se borran los clones (y con ellos lo concedido a los roles ahí) y los roles que
  // creó esta corrida. Antes de borrar un rol hay que revocarle lo que tenga en la plantilla.
  return async () => {
    const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} })
    try {
      for (const url of clones) {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${nombreBase(url)}" WITH (FORCE)`)
      }
    } finally {
      await admin.end()
    }
    if (rolesCreados.length === 0) return
    const plantilla = postgres(TEMPLATE_DATABASE_URL, { max: 1, onnotice: () => {} })
    try {
      for (const rol of rolesCreados) {
        await plantilla.unsafe(`DROP OWNED BY "${rol}"`)
        await plantilla.unsafe(`DROP ROLE "${rol}"`)
      }
    } finally {
      await plantilla.end()
    }
  }
}
