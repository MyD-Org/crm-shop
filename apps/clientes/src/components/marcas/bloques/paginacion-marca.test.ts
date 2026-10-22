import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C1 de la revisión final: `ProductosMarcaBloque` es un Server Component y no puede pasarle una
 * función (`hrefFor`) al `Pagination` del DS, que es de cliente: React no la serializa y la página
 * de la marca se rompe apenas hay una segunda página de productos. La grilla, los filtros y la
 * paginación van en un componente de cliente (`ProductosMarcaClient`) que arma `hrefFor` adentro.
 */
const DIR = join(__dirname);

describe("productos de la página de marca", () => {
  it("el bloque server no pasa funciones a componentes de cliente", () => {
    const src = readFileSync(join(DIR, "ProductosMarca.tsx"), "utf8");
    expect(src).not.toMatch(/hrefFor=/);
    expect(src).toMatch(/<ProductosMarcaClient\b/);
  });

  it("ProductosMarcaClient es de cliente, con el panel de filtros y la paginación por la URL de la marca", () => {
    const src = readFileSync(join(DIR, "..", "ProductosMarcaClient.tsx"), "utf8");
    expect(src.startsWith('"use client"')).toBe(true);
    expect(src).toMatch(/<CatalogoFiltros\b/);
    expect(src).toMatch(/hrefMarcaConEstado\(/);
  });
});
