import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda estática de `catalogo-shop-desde-crm`: el catálogo del Shop se lee
 * SÓLO de las vistas del CRM (`public.catalog_products_shop` y
 * `public.catalog_categories_shop`). La copia propia del Shop (tablas
 * catalog_products, catalog_categories y catalog_sync_log del esquema shop) y
 * su sync se retiraron: las tablas se dropean en la migración 0015. Esta guarda
 * evita que vuelvan por la puerta de atrás.
 */

const RAIZ = join(__dirname, "..");
const DRIZZLE_DIR = join(RAIZ, "..", "drizzle");
const ESTE_ARCHIVO = "lib/sin-espejo-shop.test.ts";

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : archivos(ruta);
    return /\.(ts|tsx)$/.test(e.name) ? [ruta] : [];
  });
}

const fuentes = archivos(RAIZ)
  .map((ruta) => ({
    rel: relative(RAIZ, ruta).split(sep).join("/"),
    texto: readFileSync(ruta, "utf8"),
  }))
  .filter((f) => f.rel !== ESTE_ARCHIVO);

const esTest = (rel: string) => /\.test\.tsx?$/.test(rel) || rel.includes("__fixtures__/");

/** Los exports viejos de src/db/schema.ts. */
const EXPORT_ESPEJO = /\b(catalogProducts|catalogCategories|catalogSyncLog)\b/;

/** Declarar de nuevo una de las tablas viejas en el esquema `shop`. */
const TABLA_DECLARADA = /shop\.table\(\s*["']catalog_(products|categories|sync_log)["']/;

/** El nombre calificado de una tabla vieja del Shop, con o sin comillas. */
const TABLA_VIEJA = /"?shop"?\."?catalog_(products|categories|sync_log)"?\b/;

describe("el Shop no tiene copia propia del catálogo", () => {
  it("encuentra el código a revisar", () => {
    expect(fuentes.some((f) => f.rel === "lib/catalog.ts")).toBe(true);
    expect(fuentes.some((f) => f.rel === "db/schema.ts")).toBe(true);
  });

  it("nadie declara ni nombra los exports viejos del espejo", () => {
    const culpables = fuentes
      .filter((f) => EXPORT_ESPEJO.test(f.texto) || TABLA_DECLARADA.test(f.texto))
      .map((f) => f.rel);
    expect(culpables).toEqual([]);
  });

  it("el código (no tests) no nombra shop.catalog_products, shop.catalog_categories ni shop.catalog_sync_log", () => {
    const culpables = fuentes
      .filter((f) => !esTest(f.rel) && TABLA_VIEJA.test(f.texto))
      .map((f) => f.rel);
    expect(culpables).toEqual([]);
  });

  it("0015 dropea sólo las tres tablas, sin CASCADE y sin tocar immutable_unaccent", () => {
    const sql = readFileSync(join(DRIZZLE_DIR, "0015_drop_catalogo_shop.sql"), "utf8");
    const sentencias = sql
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("--"))
      .map((l) => l.replace("--> statement-breakpoint", "").trim());
    expect(sentencias).toEqual([
      'DROP TABLE "shop"."catalog_categories";',
      'DROP TABLE "shop"."catalog_products";',
      'DROP TABLE "shop"."catalog_sync_log";',
    ]);
  });
});
