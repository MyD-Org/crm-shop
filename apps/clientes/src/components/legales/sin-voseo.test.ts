import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";

/**
 * Guarda de registro formal de usted para las páginas legales, su editor, el
 * footer y su editor (`components/footer`, `data/footer.ts`) y el Botón de
 * arrepentimiento. Entran también los `.ts`: los textos legales viven en los
 * armadores de `src/lib/legales`.
 * Las rutas que todavía no existen se saltean.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

const RUTAS = [
  "app/terminos",
  "app/privacidad",
  "app/envios-y-pagos",
  "app/arrepentimiento",
  "components/legales",
  "lib/legales",
  "components/SiteFooter.tsx",
  "components/footer",
  "data/footer.ts",
].map((r) => join(SRC, r));

const esFuente = (nombre: string) => /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre);

function fuentes(ruta: string): string[] {
  if (!existsSync(ruta)) return [];
  if (!statSync(ruta).isDirectory()) return esFuente(ruta) ? [ruta] : [];
  return readdirSync(ruta).flatMap((nombre) => fuentes(join(ruta, nombre)));
}

/** `src/lib/arrepentimiento*.ts` (lógica y mails del Botón de arrepentimiento). */
function archivosArrepentimiento(): string[] {
  const lib = join(SRC, "lib");
  return readdirSync(lib)
    .filter((n) => n.startsWith("arrepentimiento") && esFuente(n))
    .map((n) => join(lib, n));
}

describe("guarda de páginas legales: registro formal de usted", () => {
  it("recorre al menos los armadores y componentes legales", () => {
    const archivos = [...RUTAS.flatMap(fuentes), ...archivosArrepentimiento()];
    expect(archivos.some((a) => a.includes(join("lib", "legales")))).toBe(true);
    expect(archivos.some((a) => a.includes(join("components", "legales")))).toBe(true);
    expect(archivos.some((a) => a.includes(join("components", "footer")))).toBe(true);
    expect(archivos.some((a) => a.endsWith(join("data", "footer.ts")))).toBe(true);
  });

  it("atrapa voseo en un armador de texto", () => {
    expect(infracciones('parrafos: ["Completá tus datos"]', REGISTRO)).not.toEqual([]);
  });

  it("sin voseo/tuteo en los archivos legales", () => {
    const encontrados = [...RUTAS.flatMap(fuentes), ...archivosArrepentimiento()].flatMap((ruta) =>
      infracciones(readFileSync(ruta, "utf8"), REGISTRO).map((m) => `${relative(SRC, ruta)}:${m}`),
    );
    expect(encontrados, encontrados.join("\n")).toEqual([]);
  });
});
