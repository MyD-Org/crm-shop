/**
 * Corre la sync del catálogo (Alegra → espejo local) como proceso suelto.
 *
 * Existe porque la sync dejó de entrar en una función de Vercel: el plan Hobby
 * topea en 300 s y el catálogo creció a ~5959 ítems que Alegra pagina de a 30 y
 * encima limita con 429 (una corrida local tarda ~2m52s y sube). En vez de
 * pelear contra el timeout, el trabajo se movió a GitHub Actions
 * (.github/workflows/catalogo-sync.yml), que ejecuta ESTE script adentro del
 * runner: sin límite de 300 s y sin HTTP de por medio.
 *
 * El endpoint `/api/cron/catalog-sync` sigue existiendo para disparos manuales,
 * pero ya no lo llama ningún cron.
 *
 * Uso:
 *   npm run sync:catalogo
 *
 * Lee `.env.local` si está (ver el script en package.json). Termina con código
 * != 0 si algo falla, que es lo que hace fallar el job en Actions.
 */

import { syncCatalog } from "@/lib/catalog-sync";

/**
 * Variables sin las cuales el script no tiene nada que hacer.
 *
 * Se validan ANTES de arrancar y no se delega en el error que tiraría `alegra.ts`
 * o `db/index.ts` a mitad de camino: si falta un secret en Actions, el log tiene
 * que decir cuál, no un stacktrace a 40 líneas de distancia. `ALEGRA_BASE_URL`
 * no está acá a propósito: es opcional y tiene default.
 */
const REQUERIDAS = [
  ["ALEGRA_EMAIL", "email de la cuenta de Alegra (auth Basic)"],
  ["ALEGRA_TOKEN", "token de API de Alegra (Configuración → API)"],
] as const;

function validarEntorno(): void {
  const faltan = REQUERIDAS.filter(([name]) => !process.env[name]?.trim());

  // La conexión se resuelve como en el resto del código (`src/db/index.ts`):
  // cualquiera de las dos sirve, así que se valida el par y no cada una.
  const tieneDb =
    process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();

  if (faltan.length === 0 && tieneDb) return;

  console.error("[sync:catalogo] faltan variables de entorno:");
  for (const [name, para] of faltan) console.error(`  - ${name}: ${para}`);
  if (!tieneDb) {
    console.error(
      "  - DATABASE_URL (o POSTGRES_URL): conexión a Postgres del shop"
    );
  }
  console.error(
    "En local van en .env.local; en GitHub Actions son secrets del repo " +
      "(ver .github/workflows/catalogo-sync.yml)."
  );
  process.exit(1);
}

async function main(): Promise<void> {
  validarEntorno();

  const inicio = Date.now();
  console.log("[sync:catalogo] arrancando…");

  // "manual" y no "cron": el trigger queda en `catalog_sync_log` y ya no hay un
  // cron de Vercel del otro lado. Lo dispara un schedule de Actions o una persona.
  const resultado = await syncCatalog("manual");
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

  if (!resultado.ok) {
    console.error(`[sync:catalogo] falló tras ${segundos}s:`, resultado.error);
    process.exit(1);
  }

  console.log(
    `[sync:catalogo] ok en ${segundos}s — ${resultado.itemsSynced} ítems, ` +
      `${resultado.categoriesSynced} categorías`
  );
}

main()
  .then(() => {
    // `syncCatalog` deja el pool de postgres-js abierto (es un singleton pensado
    // para un server de larga vida). En un script eso mantiene el proceso vivo
    // hasta el idle_timeout, así que se sale explícitamente.
    process.exit(0);
  })
  .catch((err) => {
    console.error("[sync:catalogo] error inesperado:", err);
    process.exit(1);
  });
