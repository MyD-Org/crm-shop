import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  bannerDestino,
  esRolDeRuntime,
  leerUrlMigracion,
  mensajeRolDeRuntime,
} from "./migrate-destino";

/**
 * Aplica la migración del Shop al esquema `shop`.
 *
 * Las reglas (de dónde sale la URL, qué se imprime, qué rol puede migrar) están
 * en `migrate-destino.ts`, que se testea sin base. Acá queda solo lo que
 * necesita una conexión.
 */
async function main() {
  // Falla ANTES de abrir ninguna conexión si falta la variable o apunta al pooler.
  const { url, host } = leerUrlMigracion(process.env);

  const client = postgres(url, {
    max: 1,
    // Postgres emite NOTICE por cada `IF NOT EXISTS` que saltea ("schema shop
    // already exists"). Son señal de que la migración es idempotente, no errores,
    // pero impresos crudos parecen fallas. Se muestran solo con DEBUG_SQL=1.
    onnotice: process.env.DEBUG_SQL ? undefined : () => {},
  });

  try {
    const [quien] = await client<
      { rol: string; base: string; puede_crear: boolean }[]
    >`select current_user as rol, current_database() as base,
        has_database_privilege(current_user, current_database(), 'CREATE') as puede_crear`;

    // El destino se muestra antes de tocar nada: es la última oportunidad de
    // ver que la variable apunta a otra base de la que uno creía.
    console.log(bannerDestino({ host, base: quien.base, rol: quien.rol }));

    if (esRolDeRuntime(quien.rol, quien.puede_crear)) {
      throw new Error(mensajeRolDeRuntime(quien.rol));
    }

    // `migrationsSchema: "shop"`: la bitácora vive en shop.__drizzle_migrations.
    // La default (drizzle.__drizzle_migrations) es la del CRM en esta misma
    // base; compartirla haría que sus migraciones, más nuevas, saltearan la nuestra.
    // Sin `search_path`: la baseline califica todo con "shop".
    await migrate(drizzle(client), {
      migrationsFolder: "./drizzle",
      migrationsSchema: "shop",
    });

    const [{ total }] = await client<
      { total: number }[]
    >`select count(*)::int as total from "shop"."__drizzle_migrations"`;
    console.log(
      `[db:migrate] listo: shop.__drizzle_migrations tiene ${total} fila(s)`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // Por defecto solo el mensaje: alcanza para los cortes de arriba y no vuelca
  // el objeto de error de postgres-js. Con DEBUG_SQL=1 sale completo (sentencia
  // que falló, posición), que es lo que hace falta si rompe la baseline.
  console.error(
    `[db:migrate] ${err instanceof Error ? err.message : String(err)}`
  );
  if (process.env.DEBUG_SQL) console.error(err);
  process.exit(1);
});
