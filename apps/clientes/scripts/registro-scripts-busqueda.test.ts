import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ruta = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

describe("scripts de consultas reales registrados", () => {
  const scripts = (JSON.parse(readFileSync(ruta("../package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  it("busqueda:extraer carga el entorno local con tsx y apunta al CLI", () => {
    expect(scripts["busqueda:extraer"]).toBe("tsx --env-file-if-exists=.env.local scripts/extraer-consultas-reales.ts");
    expect(existsSync(ruta("./extraer-consultas-reales.ts"))).toBe(true);
  });

  it("busqueda:compilar-banco no necesita entorno (sólo archivos locales)", () => {
    expect(scripts["busqueda:compilar-banco"]).toBe("tsx scripts/compilar-banco-real.ts");
    expect(existsSync(ruta("./compilar-banco-real.ts"))).toBe(true);
  });

  it("no hay package.json ni lockfile en la raíz del monorepo", () => {
    for (const f of ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
      expect(existsSync(ruta(`../../../${f}`))).toBe(false);
    }
  });
});
