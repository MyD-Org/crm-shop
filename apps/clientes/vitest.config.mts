import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Tests de la lógica pura del shop.
 *
 * `environment: node` a propósito: lo que se testea acá son módulos sin DOM
 * —cálculo de IVA, validación de CUIT, reglas de envío, rate limit—. El día que
 * haya tests de componentes van a necesitar jsdom, y conviene que sea una
 * decisión explícita y no algo que ya venía puesto.
 *
 * El alias `@/` se resuelve a mano en vez de sumar `vite-tsconfig-paths`: es
 * una línea contra una dependencia más que auditar. Si algún día tsconfig gana
 * más paths, ahí sí conviene el plugin.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
