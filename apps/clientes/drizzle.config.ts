import { defineConfig } from "drizzle-kit";

// Una sola variable, explícita y sin cadena de respaldo: las migraciones del
// Shop corren con el rol dueño por conexión directa, que NO es la conexión de
// runtime (rol `shop_app`, pooled). Con un respaldo a la variable de runtime, un
// `drizzle-kit migrate` tipeado a mano caería sobre lo que hubiera en el entorno.
//
// `db:generate` no se conecta a ninguna base: sin la variable, `dbCredentials`
// directamente no se declara.
const url = process.env.MIGRATE_DATABASE_URL;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // El Shop solo es dueño del esquema `shop`; `public` es del CRM.
  schemaFilter: ["shop"],
  // Control de migraciones propio, en `shop.__drizzle_migrations`. El default
  // (`drizzle.__drizzle_migrations`) es el del CRM en esta misma base: compartirlo
  // haría que drizzle saltee las migraciones del Shop por fecha. `db:migrate` usa
  // src/db/migrate.ts y no este bloque; está para que un `drizzle-kit migrate`
  // manual tampoco toque el control del CRM.
  migrations: { schema: "shop", table: "__drizzle_migrations" },
  ...(url ? { dbCredentials: { url } } : {}),
});
