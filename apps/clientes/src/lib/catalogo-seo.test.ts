import { describe, expect, it, vi } from "vitest";

const totales = vi.fn();
vi.mock("./catalogo-publico", () => ({ categoriasTotalesPublicas: (...a: unknown[]) => totales(...a) }));
vi.mock("./flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: true, variantes: false }) }));
vi.mock("./zona-servidor", () => ({ dispCatalogo: async () => undefined }));

import { categoriasIndexables, metadataDeCategoria, rutaDeCategoria } from "./catalogo-seo";

describe("SEO de las páginas de categoría", () => {
  it("sólo las categorías con productos, sin repetir", async () => {
    totales.mockResolvedValue([
      { label: "Paneles", count: 3, nivel: 2 },
      { label: "Vacía", count: 0, nivel: 2 },
      { label: "Paneles", count: 3, nivel: 2 },
    ]);
    expect(await categoriasIndexables()).toEqual(["Paneles"]);
  });

  it("si la lectura falla, ninguna (no rompe el sitemap ni la metadata)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    totales.mockRejectedValue(new Error("base caída"));
    expect(await categoriasIndexables()).toEqual([]);
  });

  it("la ruta es la canónica de la categoría", () => {
    expect(rutaDeCategoria("Luminarias exteriores")).toBe("/catalogo?categoria=Luminarias+exteriores");
  });

  it("título con el nombre (y la página si no es la primera) y una descripción propia", () => {
    expect(metadataDeCategoria("Paneles", 1).title).toBe("Paneles");
    expect(metadataDeCategoria("Paneles", 3).title).toBe("Paneles (página 3)");
    expect(metadataDeCategoria("Paneles", 1).description).toContain("Paneles");
  });
});
