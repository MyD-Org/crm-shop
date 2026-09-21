import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El runtime lee SOLO `DATABASE_URL`. Se prueba por el lado que importa: con
 * las otras variables puestas, `getDb()` tiene que fallar antes de construir el
 * cliente. Si algún fallback volviera, el test pasaría a conectarse (perezoso)
 * en vez de tirar, y se pondría rojo.
 */
const VARIABLES = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "MIGRATE_DATABASE_URL",
] as const;

const URL_FALSA = "postgres://u:p@127.0.0.1:1/none";

describe("getDb: variable de conexión", () => {
  const previas: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of VARIABLES) {
      previas[v] = process.env[v];
      delete process.env[v];
    }
    delete (globalThis as { shopDb?: unknown }).shopDb;
    vi.resetModules();
  });

  afterEach(() => {
    for (const v of VARIABLES) {
      if (previas[v] === undefined) delete process.env[v];
      else process.env[v] = previas[v];
    }
    delete (globalThis as { shopDb?: unknown }).shopDb;
  });

  it("POSTGRES_URL ya no se honra: sin DATABASE_URL falla la configuración", async () => {
    process.env.POSTGRES_URL = URL_FALSA;
    process.env.POSTGRES_URL_NON_POOLING = URL_FALSA;
    const { getDb } = await import("./index");
    expect(() => getDb()).toThrow(
      "Falta DATABASE_URL en el entorno (rol shop_app, conexión pooled). POSTGRES_URL ya no se usa."
    );
  });

  it("el runtime ignora MIGRATE_DATABASE_URL", async () => {
    process.env.MIGRATE_DATABASE_URL = URL_FALSA;
    const { getDb } = await import("./index");
    expect(() => getDb()).toThrow(/Falta DATABASE_URL/);
  });

  it("con DATABASE_URL arma el cliente sin conectarse", async () => {
    process.env.DATABASE_URL = URL_FALSA;
    const { getDb, connectionString } = await import("./index");
    expect(connectionString()).toBe(URL_FALSA);
    // postgres-js es perezoso: construir el cliente no abre ningún socket.
    expect(getDb()).toBeDefined();
  });
});
