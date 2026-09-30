import { describe, expect, it } from "vitest";
import {
  atributosParaAgente,
  caracteristicasDe,
  etiquetasTecnicas,
  formatoValor,
  leerAtributosEstructurados,
} from "./catalogo-caracteristicas";

describe("leerAtributosEstructurados", () => {
  it("valida el jsonb de la consulta: claves conocidas, numeric como string, vacíos afuera", () => {
    expect(
      leerAtributosEstructurados({
        potencia_w: { n: "50", t: null },
        tono: { n: null, t: "calido" },
        color: { n: null, t: "rojo" },
        ip: { n: null, t: "" },
      }),
    ).toEqual({ potencia_w: { n: 50, t: null }, tono: { n: null, t: "calido" } });
  });

  it("null, arrays o sin nada útil ⇒ undefined", () => {
    expect(leerAtributosEstructurados(null)).toBeUndefined();
    expect(leerAtributosEstructurados([])).toBeUndefined();
    expect(leerAtributosEstructurados({ ip: { n: null, t: null } })).toBeUndefined();
  });
});

describe("formato", () => {
  it("valores legibles", () => {
    expect(formatoValor("potencia_w", { n: 4.5, t: null })).toBe("4,5 W");
    expect(formatoValor("temperatura_k", { n: 3000, t: null })).toBe("3000 K");
    expect(formatoValor("ip", { n: 65, t: null })).toBe("IP65");
    expect(formatoValor("tension_v", { n: 220, t: "85-265" })).toBe("85–265 V");
    expect(formatoValor("tension_v", { n: 12, t: null })).toBe("12 V");
    expect(formatoValor("tono", { n: null, t: "calido" })).toBe("Cálida");
    expect(formatoValor("zocalo", { n: null, t: "gu10" })).toBe("GU10");
    expect(formatoValor("potencia_w", undefined)).toBeNull();
  });

  it("tabla Características en orden fijo", () => {
    expect(
      caracteristicasDe({
        zocalo: { n: null, t: "e27" },
        potencia_w: { n: 9, t: null },
        tono: { n: null, t: "frio" },
      }),
    ).toEqual([
      { etiqueta: "Potencia", valor: "9 W" },
      { etiqueta: "Tono de luz", valor: "Fría" },
      { etiqueta: "Base / zócalo", valor: "E27" },
    ]);
    expect(caracteristicasDe(undefined)).toEqual([]);
  });

  it("compacto para el agente y etiquetas técnicas para la card", () => {
    const a = { potencia_w: { n: 12, t: null }, tension_v: { n: 220, t: "85-265" }, tono: { n: null, t: "calido" } };
    expect(atributosParaAgente(a)).toEqual({ potencia_w: 12, tono: "calido", tension_v: "85-265" });
    expect(atributosParaAgente(undefined)).toBeUndefined();
    expect(etiquetasTecnicas(a)).toEqual(["12 W", "85–265 V"]);
  });
});
