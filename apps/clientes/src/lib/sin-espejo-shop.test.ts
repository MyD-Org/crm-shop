import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda estática de `catalogo-shop-desde-crm` (PR-2): el catálogo del Shop se
 * lee SÓLO de las vistas del CRM (`public.catalog_products_shop` y
 * `public.catalog_categories_shop`). Las tablas propias del Shop
 * (`shop.catalog_products`, `shop.catalog_categories`, `shop.catalog_sync_log`)
 * sólo las toca su sync, que se retira en PR-3; las tablas se dropean en PR-4
 * (migración 0014 del Shop). Cada PR achica la lista de excepciones.
 */

const RAIZ = join(__dirname, "..");

/** Rutas relativas a `src/`, con `/`. */
const EXCEPCIONES_IMPORT = new Set([
  "db/schema.ts",
  "lib/catalog-sync.ts",
  "lib/catalog-sync.test.ts",
  // Este archivo: nombra el patrón en su propia documentación.
  "lib/sin-espejo-shop.test.ts",
]);
const EXCEPCIONES_SQL = new Set(["db/schema.ts", "lib/catalog-sync.ts"]);

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : archivos(ruta);
    return /\.(ts|tsx)$/.test(e.name) ? [ruta] : [];
  });
}

const fuentes = archivos(RAIZ).map((ruta) => ({
  rel: relative(RAIZ, ruta).split(sep).join("/"),
  texto: readFileSync(ruta, "utf8"),
}));

const esTest = (rel: string) => /\.test\.tsx?$/.test(rel) || rel.includes("__fixtures__/");

/** `import { …catalogProducts… } from "@/db/schema"` (o relativo a db/schema). */
const IMPORT_ESPEJO =
  /import\s*(?:type\s*)?\{[^}]*\b(catalogProducts|catalogCategories|catalogSyncLog)\b[^}]*\}\s*from\s*["'](?:@\/db\/schema|(?:\.{1,2}\/)+(?:db\/)?schema)["']/;

/** El nombre de una tabla vieja del Shop, con o sin comillas. */
const TABLA_VIEJA = /"?shop"?\."?catalog_(products|categories)"?\b/;

describe("el Shop no lee su copia vieja del catálogo", () => {
  it("encuentra el código a revisar", () => {
    expect(fuentes.some((f) => f.rel === "lib/catalog.ts")).toBe(true);
  });

  it("nadie importa las tablas del espejo del Shop fuera de su sync y del esquema", () => {
    const culpables = fuentes
      .filter((f) => !EXCEPCIONES_IMPORT.has(f.rel) && IMPORT_ESPEJO.test(f.texto))
      .map((f) => f.rel);
    expect(culpables).toEqual([]);
  });

  it("el código (no tests) no nombra shop.catalog_products ni shop.catalog_categories", () => {
    const culpables = fuentes
      .filter((f) => !esTest(f.rel) && !EXCEPCIONES_SQL.has(f.rel) && TABLA_VIEJA.test(f.texto))
      .map((f) => f.rel);
    expect(culpables).toEqual([]);
  });
});
