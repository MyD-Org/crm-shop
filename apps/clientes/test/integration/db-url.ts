// URL de la DB de test para los tests de integración del Shop. SIEMPRE local y con nombre que
// incluya "test": red de seguridad para que estos tests (que truncan tablas) NUNCA puedan tocar
// una base real (Neon). El DATABASE_URL del entorno / .env.local se ignora a propósito.
// Base propia (`shop_test`) para no pisarse con la `crm_test` del CRM si corren a la vez.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://localhost:5432/shop_test";

// URL a la base "postgres" del mismo servidor, para poder crear la de test.
export const ADMIN_DATABASE_URL = TEST_DATABASE_URL.replace(/\/[^/]+(\?.*)?$/, "/postgres");

/** Falla si la URL no es una DB LOCAL de test (host localhost, nombre con "test"). */
export function assertLocalTestDb(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TEST_DATABASE_URL inválida");
  }
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!isLocalHost || !/test/i.test(dbName)) {
    throw new Error(
      `Los tests de integración solo corren contra una DB LOCAL de test (host localhost, nombre con "test"). ` +
        `Recibí host="${parsed.hostname}" db="${dbName}". Abortando para no tocar datos reales.`,
    );
  }
}
