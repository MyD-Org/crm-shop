import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C1 de la revisión final: `ProductosMarcaBloque` es un Server Component y no puede pasarle una
 * función (`hrefFor`) al `Pagination` del DS, que es de cliente: React no la serializa y la página
 * de la marca se rompe apenas hay una segunda página de productos. La paginación va en un
 * componente de cliente propio que arma `hrefFor` adentro.
 */
const DIR = join(__dirname);

describe("paginación de la página de marca", () => {
  it("el bloque server no pasa funciones a Pagination", () => {
    const src = readFileSync(join(DIR, "ProductosMarca.tsx"), "utf8");
    expect(src).not.toMatch(/hrefFor=/);
    expect(src).toMatch(/<PaginacionMarca\b/);
  });

  it("PaginacionMarca es de cliente y arma los enlaces con hrefPaginaMarca", () => {
    const src = readFileSync(join(DIR, "..", "PaginacionMarca.tsx"), "utf8");
    expect(src.startsWith('"use client"')).toBe(true);
    expect(src).toMatch(/hrefPaginaMarca\(/);
  });
});
