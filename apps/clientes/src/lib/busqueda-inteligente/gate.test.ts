import { describe, expect, it } from "vitest";
import { debeInterpretar, pareceCodigo, pareceLenguajeNatural } from "./gate";

describe("pareceCodigo", () => {
  it.each(["DL-18W", "NXB-125", "C479056476B7", "TM-2x16", "e27", "779123456789", "220/12"])("%s es código", (q) => {
    expect(pareceCodigo(q)).toBe(true);
  });

  it.each(["reflector", "luz calida", "reflector 50w", "12", "tira led"])("%s no es código", (q) => {
    expect(pareceCodigo(q)).toBe(false);
  });
});

describe("pareceLenguajeNatural", () => {
  it("tres o más palabras", () => {
    expect(pareceLenguajeNatural("reflector led calido")).toBe(true);
    expect(pareceLenguajeNatural("reflector led")).toBe(false);
  });

  it("palabras de relación, con o sin tildes y mayúsculas", () => {
    expect(pareceLenguajeNatural("luz para patio")).toBe(true);
    expect(pareceLenguajeNatural("Busco foco")).toBe(true);
    expect(pareceLenguajeNatural("lámpara cómo")).toBe(true);
    expect(pareceLenguajeNatural("tira led")).toBe(false);
  });
});

describe("debeInterpretar", () => {
  it("un código nunca se interpreta, aunque no traiga nada", () => {
    expect(debeInterpretar("DL-18W", 0)).toBe(false);
  });

  it("lenguaje natural se interpreta aunque haya muchos resultados", () => {
    expect(debeInterpretar("luz para el patio", 120)).toBe(true);
  });

  it("términos sueltos sólo con pocos resultados (menos de 4)", () => {
    expect(debeInterpretar("reflector", 50)).toBe(false);
    expect(debeInterpretar("reflecter", 3)).toBe(true);
    expect(debeInterpretar("reflecter", 4)).toBe(false);
  });

  it("sin búsqueda no hay nada que interpretar", () => {
    expect(debeInterpretar(undefined, 0)).toBe(false);
    expect(debeInterpretar("   ", 0)).toBe(false);
  });
});
