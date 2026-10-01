import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { TEST_DATABASE_URL } from "./test/integration/db-url";

/**
 * Dos proyectos:
 *  - unit:        lógica pura del shop, sin DB. `environment: node` a propósito: nada de DOM.
 *                 Los flags de Vercel Flags se leen de un estado en memoria (src/test/flags.ts).
 *  - integration: contra una Postgres LOCAL de test (`shop_test`) que el globalSetup crea y migra
 *                 con las migraciones reales de las dos apps. Nunca toca una base remota
 *                 (guarda en db-url.ts).
 *
 * `npm test` corre solo unit; `npm run test:integration` los de DB; `npm run test:all` ambos.
 *
 * El alias `@/` se resuelve a mano en vez de sumar `vite-tsconfig-paths`.
 */
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          setupFiles: ["src/test/setup-flags.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["test/integration/**/*.test.ts"],
          env: { DATABASE_URL: TEST_DATABASE_URL, SHOP_TENANT_ID: "tenant-test" },
          globalSetup: ["./test/integration/global-setup.ts"],
          // Comparten la misma DB de test: sin paralelismo entre archivos.
          fileParallelism: false,
        },
      },
    ],
  },
});
