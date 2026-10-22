import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Las fotos sin fondo de Led Premium vienen recortadas al ras del producto (las necesita el estilo
 * estudio) y en una card normal llenan el recuadro. En las páginas de marca y en el bloque Tienda
 * oficial de la home (decisión de Emanuel: SOLO ahí) se les suma aire con `data-fotos-con-aire`.
 * En /catalogo y en la ficha no cambia nada.
 */
const leer = (...p: string[]) => readFileSync(join(__dirname, ...p), "utf8");
const css = leer("..", "..", "app", "globals.css");

describe("fotos con aire en la tienda de la marca", () => {
  it("el CSS suma padding a la foto de las cards de grilla dentro de [data-fotos-con-aire]", () => {
    expect(css).toMatch(/\[data-fotos-con-aire\] \[data-card-producto\]:not\(\[data-layout="list"\]\) > div:first-child img\s*\{[^}]*padding/);
  });

  it("la regla de aire va ANTES de la del estudio (que define su propio padding y tiene que ganar)", () => {
    expect(css.indexOf("[data-fotos-con-aire]")).toBeGreaterThan(-1);
    expect(css.indexOf("[data-fotos-con-aire]")).toBeLessThan(css.indexOf("[data-estudio] [data-card-producto] > div:first-child img"));
  });

  it("la página de marca y el bloque de la home marcan su contenido; las cards de grilla llevan el gancho", () => {
    expect(leer("PaginaMarcaVista.tsx")).toMatch(/data-fotos-con-aire=""/);
    expect(leer("..", "home", "TiendaOficialHome.tsx")).toMatch(/data-fotos-con-aire=""/);
    expect(leer("..", "catalogo", "CatalogoProductos.tsx")).toMatch(/data-card-producto=""/);
  });
});
