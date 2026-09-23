import { createInterface } from "node:readline/promises"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { destinoMigracion } from "./migrate-destino"

// `npm run db:migrate` carga .env.local, que en una máquina de desarrollo apunta a la base
// LOCAL, y el migrator dice "migrations applied" aunque no haya aplicado nada. Pasó con la
// 0030/0031 (espejo de contactos): se aplicó en local creyendo que era prod. Por eso ahora
// siempre dice a qué base va, y contra una base que no es local pide escribir el host.
//
// Sin terminal (CI, scripts): confirmar con MIGRATE_CONFIRM=<host>.

async function confirmar(host: string): Promise<boolean> {
  if (process.env.MIGRATE_CONFIRM === host) return true
  if (!process.stdin.isTTY) {
    console.error(`Base NO local (${host}). Sin terminal: correr con MIGRATE_CONFIRM=${host} para confirmar.`)
    return false
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const escrito = await rl.question(`Escriba el host para confirmar (${host}): `)
    return escrito.trim() === host
  } finally {
    rl.close()
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/crm"
  const destino = destinoMigracion(url)
  console.log(`Migrando ${destino.local ? "base LOCAL" : "base REMOTA"}: ${destino.host}/${destino.base}`)
  if (!destino.local && !(await confirmar(destino.host))) {
    console.error("Cancelado: no se aplicó ninguna migración.")
    process.exit(1)
  }

  const client = postgres(url, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" })
    // El migrator no dice cuántas aplicó: se informa la última registrada para poder
    // compararla con la carpeta ./drizzle.
    const [ultima] = await client`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`
    console.log(`migrations applied · ${ultima.n} registradas en ${destino.host}/${destino.base}`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
