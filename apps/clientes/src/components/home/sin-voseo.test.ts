import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";

/**
 * Guarda estática de registro formal de usted (CLAUDE.md raíz) para
 * `src/components/home/**` (editor in-place de la home, `home-editable`).
 * Copia reducida de `../mi-cuenta/sin-literales.test.ts` (solo la regla de
 * registro: acá no aplica la paleta del DS porque todavía no hay componentes
 * visuales más allá de la barra).
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const CARPETA = join(SRC, "components", "home");

function tsxRecursivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return tsxRecursivos(ruta);
    return nombre.endsWith(".tsx") && !nombre.endsWith(".test.tsx") ? [ruta] : [];
  });
}

describe("guarda de src/components/home: registro formal de usted", () => {
  it("atrapa voseo y tuteo en el texto, no en comentarios", () => {
    expect(infracciones("<p>Revisá tus datos</p>", REGISTRO)).not.toEqual([]);
    expect(infracciones("// antes decía: revisá tus datos", REGISTRO)).toEqual([]);
    expect(infracciones("<p>Verifique sus datos</p>", REGISTRO)).toEqual([]);
  });

  it("sin voseo/tuteo en los archivos de src/components/home", () => {
    const encontrados = tsxRecursivos(CARPETA).flatMap((ruta) =>
      infracciones(readFileSync(ruta, "utf8"), REGISTRO).map((m) => `${relative(SRC, ruta)}:${m}`),
    );
    expect(encontrados, encontrados.join("\n")).toEqual([]);
  });
});
