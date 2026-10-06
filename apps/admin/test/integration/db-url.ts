import { availableParallelism } from "node:os"

// URL de la DB de test para los tests de integración. SIEMPRE local y con nombre que incluya
// "test": es la red de seguridad para que estos tests (que truncan tablas) NUNCA puedan tocar
// una DB real. La URL de prod vive en .env.local; acá la ignoramos a propósito.
//
// Los archivos de integración corren en paralelo, cada worker contra SU base: el global-setup
// migra la base "plantilla" (crm_test) y la clona como crm_test_w1..crm_test_wN. Dentro de un
// worker, vitest define VITEST_POOL_ID (1..maxWorkers) y TEST_DATABASE_URL apunta a su clon;
// fuera de un worker (config, global-setup) es la plantilla.

export const TEMPLATE_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://localhost:5432/crm_test"

/** Workers de vitest (lo usa vitest.config.ts) = cantidad de clones que crea el global-setup. */
export const TEST_WORKERS = Math.max(availableParallelism() - 1, 1)

const conBase = (url: string, db: string) => url.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`)
const nombreBase = (url: string) => new URL(url).pathname.replace(/^\//, "")

/** URL del clon del worker `n` (1..TEST_WORKERS). */
export function workerDatabaseUrl(n: number): string {
  return conBase(TEMPLATE_DATABASE_URL, `${nombreBase(TEMPLATE_DATABASE_URL)}_w${n}`)
}

export const TEST_DATABASE_URL = process.env.VITEST_POOL_ID
  ? workerDatabaseUrl(Number(process.env.VITEST_POOL_ID))
  : TEMPLATE_DATABASE_URL

// URL a la base "postgres" del mismo servidor, para poder crear las DBs de test (CREATE DATABASE
// no puede correr sobre la propia DB que se está creando).
export const ADMIN_DATABASE_URL = conBase(TEMPLATE_DATABASE_URL, "postgres")

/**
 * Falla ruidosamente si la URL no parece una DB de test LOCAL. Evita que un DATABASE_URL de
 * prod (ej. el de .env.local) se cuele y los tests trunquen datos reales. La llaman el
 * global-setup (antes de migrar) y el helper de truncate (antes de borrar).
 */
export function assertLocalTestDb(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`TEST_DATABASE_URL inválida: ${url}`)
  }
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
  const dbName = parsed.pathname.replace(/^\//, "")
  const looksLikeTest = /test/i.test(dbName)
  if (!isLocalHost || !looksLikeTest) {
    throw new Error(
      `Los tests de integración solo corren contra una DB LOCAL de test (host localhost, nombre con "test"). ` +
        `Recibí host="${parsed.hostname}" db="${dbName}". Abortando para no tocar datos reales.`,
    )
  }
}
