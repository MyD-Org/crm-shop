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
  } finally {
    await client.end()
  }
}
