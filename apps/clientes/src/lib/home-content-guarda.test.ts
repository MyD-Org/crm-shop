import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda de fuente: `homeContent` (la tabla compartida entre tiendas) solo se
 * toca desde los dos módulos que filtran por `shopTenantId()`. Otro archivo
 * que la importe podría leer o escribir sin tenant.
 */
const SRC = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const PERMITIDOS = new Set(["/lib/home-guardar.ts", "/lib/home-datos.ts", "/db/schema.ts"]);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}

describe("homeContent solo se importa desde los módulos con filtro de tenant", () => {
  it("ningún otro archivo de src lo usa", () => {
    const fuera = archivos(SRC)
      .map((p) => p.slice(SRC.length))
      .filter((rel) => /\.(ts|tsx)$/.test(rel) && !/\.test\.tsx?$/.test(rel) && !PERMITIDOS.has(rel))
      .filter((rel) => /\bhomeContent\b/.test(readFileSync(`${SRC}${rel}`, "utf8")));
    expect(fuera).toEqual([]);
  });
});
