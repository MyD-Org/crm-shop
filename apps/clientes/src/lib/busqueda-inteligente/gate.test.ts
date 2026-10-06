import { describe, expect, it } from "vitest";
import { debeInterpretar, pareceCodigo, pareceLenguajeNatural } from "./gate";

describe("pareceCodigo", () => {
  it.each(["DL-18W", "NXB-125", "C479056476B7", "TM-2x16", "779123456789", "220/12"])("%s es código", (q) => {
    expect(pareceCodigo(q)).toBe(true);
  });

  it.each(["reflector", "luz calida", "reflector 50w", "12", "tira led"])("%s no es código", (q) => {
    expect(pareceCodigo(q)).toBe(false);
  });

  describe("un token que es una medida pura no es código (busqueda-medidas, R2.1)", () => {
    it.each(["20a", "ip65", "e27", "9w", "6ka", "4000k", "24v", "30ma", "gu10", "20A", "E27", "IP65", "9,5w", "2.5mm2"])(
      "%s no es código",
      (q) => {
        expect(pareceCodigo(q)).toBe(false);
      },
    );

    it.each(["DL-18W", "TM-2x16", "XQ-4471B", "C479056476B7", "NXB-125", "c16", "100", "7791234567890", "4471b", "220/12", "2x20", "60x60", "4x16a"])(
      "%s sigue siendo código",
      (q) => {
        expect(pareceCodigo(q)).toBe(true);
      },
    );

    it.each(["12000k", "ip70", "ip6", "9999999w", "e2", "e99"])("%s tiene la forma de una medida pero fuera de rango: sigue siendo código", (q) => {
      expect(pareceCodigo(q)).toBe(true);
    });

    it("NxM sin contexto ('2x20', '60x60') no es medida: el parser no la emite, así que sigue siendo código", () => {
      for (const q of ["2x20", "60x60", "4x16a"]) expect(pareceCodigo(q), q).toBe(true);
    });

    it("un número de 3 o más cifras sin unidad es código aunque sea un valor posible", () => {
      expect(pareceCodigo("120")).toBe(true);
      expect(pareceCodigo("100")).toBe(true);
    });

    it("el texto con la medida pegada no es un token puro: sin cambio", () => {
      expect(pareceCodigo("termica 2x20")).toBe(false);
      expect(pareceCodigo("lampara 9w")).toBe(false);
    });

    it("la firma es la de siempre: un string, un booleano", () => {
      expect(pareceCodigo.length).toBe(1);
      expect(typeof pareceCodigo("20a")).toBe("boolean");
    });
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
