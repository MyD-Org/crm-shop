import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda estática: todo `/api/internal/<x>/revalidar` lo llama el CRM con
 * Bearer y sin cookie de gate. Si no está en RUTAS_PUBLICAS, la cortina de
 * "Próximamente" responde 200 con HTML y el CRM lo da por propagado.
 */

const PROXY = fileURLToPath(new URL("./proxy.ts", import.meta.url));
const INTERNAL = fileURLToPath(new URL("./app/api/internal", import.meta.url));

function rutasRevalidar(): string[] {
  return readdirSync(INTERNAL, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      try {
        readFileSync(join(INTERNAL, d.name, "revalidar", "route.ts"));
        return [`/api/internal/${d.name}/revalidar`];
      } catch {
        return [];
      }
    });
}

describe("proxy: RUTAS_PUBLICAS", () => {
  it("incluye cada endpoint interno de revalidación", () => {
    const texto = readFileSync(PROXY, "utf8");
    const rutas = rutasRevalidar();
    expect(rutas).toContain("/api/internal/cuotas/revalidar");
    for (const ruta of rutas) expect(texto).toContain(`"${ruta}"`);
  });
});
