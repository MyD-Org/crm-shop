import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  // DDL por la conexión directa, no por el pooler: Neon expone la sin-pool en
  // POSTGRES_URL_NON_POOLING y es la recomendada para migraciones.
  const url =
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL;
  if (!url) throw new Error("Falta DATABASE_URL (o POSTGRES_URL)");
  const client = postgres(url, {
    max: 1,
    // Postgres emite NOTICE por cada `IF NOT EXISTS` que saltea ("schema drizzle
    // already exists"). Son señal de que la migración es idempotente, no errores,
    // pero impresos crudos parecen fallas. Se muestran solo con DEBUG_SQL=1.
    onnotice: process.env.DEBUG_SQL ? undefined : () => {},
  });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("migrations applied");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
