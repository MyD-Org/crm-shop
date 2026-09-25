import { describe, expect, it } from "vitest";
import { arrastraLaHoja, debeCerrarHoja } from "./hoja-arrastre";

describe("debeCerrarHoja", () => {
  it("cierra si se bajó un cuarto del alto", () => {
    expect(debeCerrarHoja(150, 600, 0)).toBe(true);
    expect(debeCerrarHoja(149, 600, 0)).toBe(false);
  });

  it("en hojas bajas exige al menos 80 px", () => {
    expect(debeCerrarHoja(79, 200, 0)).toBe(false);
    expect(debeCerrarHoja(80, 200, 0)).toBe(true);
  });

  it("un tirón rápido cierra aunque el recorrido sea corto", () => {
    expect(debeCerrarHoja(40, 600, 0.8)).toBe(true);
    expect(debeCerrarHoja(20, 600, 0.8)).toBe(false);
  });

  it("hacia arriba o sin moverse no cierra", () => {
    expect(debeCerrarHoja(0, 600, 1)).toBe(false);
    expect(debeCerrarHoja(-200, 600, 1)).toBe(false);
  });
});

describe("arrastraLaHoja", () => {
  it("desde el encabezado, hacia abajo, arrastra aunque el contenido esté scrolleado", () => {
    expect(arrastraLaHoja({ dx: 0, dy: 10, enEncabezado: true, scrollArriba: false })).toBe(true);
  });

  it("en el contenido arrastra sólo si ya está arriba de todo", () => {
    expect(arrastraLaHoja({ dx: 0, dy: 10, enEncabezado: false, scrollArriba: true })).toBe(true);
    expect(arrastraLaHoja({ dx: 0, dy: 10, enEncabezado: false, scrollArriba: false })).toBe(false);
  });

  it("hacia arriba o de costado deja scrollear", () => {
    expect(arrastraLaHoja({ dx: 0, dy: -10, enEncabezado: true, scrollArriba: true })).toBe(false);
    expect(arrastraLaHoja({ dx: 20, dy: 10, enEncabezado: true, scrollArriba: true })).toBe(false);
  });
});
