import { describe, expect, it } from "vitest";
import { llmsTxt } from "./llms-txt";

const base = {
  nombre: "Tienda  Ejemplo",
  descripcion: "Iluminación\ny electricidad",
  base: "https://cliente.example",
  paginas: [],
};

describe("llmsTxt", () => {
  it("empieza con un H1 y la descripción en una cita de una línea", () => {
    const txt = llmsTxt(base);
    expect(
      txt.startsWith("# Tienda Ejemplo\n\n> Iluminación y electricidad\n"),
    ).toBe(true);
  });

  it("usa enlaces absolutos al sitio", () => {
    const txt = llmsTxt(base);
    expect(txt).toContain("- [Catálogo](https://cliente.example/catalogo)");
    expect(txt).toContain("(https://cliente.example/sitemap.xml)");
    expect(txt).not.toMatch(/\]\(\//);
  });

  it("lista las páginas institucionales publicadas sólo si hay", () => {
    expect(llmsTxt(base)).not.toContain("## Información");
    const txt = llmsTxt({
      ...base,
      paginas: [{ label: "Quiénes somos", href: "/quienes-somos" }],
    });
    expect(txt).toContain(
      "## Información\n\n- [Quiénes somos](https://cliente.example/quienes-somos)",
    );
  });
});
