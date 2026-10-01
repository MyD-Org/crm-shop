import { describe, expect, it } from "vitest";
import { raizPlural } from "../../catalogo-busqueda";
import { SINONIMOS, expansiones } from "./sinonimos";

describe("sinónimos", () => {
  it("claves normalizadas, en singular y sin marcas ni códigos", () => {
    for (const [clave, valores] of Object.entries(SINONIMOS)) {
      expect(clave).toMatch(/^[a-z ]+$/);
      if (!clave.includes(" ")) expect(raizPlural(clave)).toBe(clave);
      expect(valores.length).toBeGreaterThan(0);
      for (const v of valores) expect(v).toMatch(/^[a-z0-9 -]+$/);
    }
    expect(Object.keys(SINONIMOS).length).toBeGreaterThanOrEqual(70);
  });

  it("expande palabras sueltas y frases, sin repetir lo que ya está en la consulta", () => {
    expect(expansiones(["foco", "calido"], "foco calido")).toEqual(["lampara", "bulbo"]);
    expect(expansiones(["proyector", "reflector"], "proyector reflector")).toEqual([]);
    expect(expansiones(["llave", "luz", "doble"], "llave de luz doble")).toEqual(
      expect.arrayContaining(["interruptor", "tecla", "modulo"]),
    );
    expect(expansiones(["termica"], "termica 20 amperes")).toEqual(["termomagnet"]);
    expect(expansiones(["nada"], "nada")).toEqual([]);
  });
});
