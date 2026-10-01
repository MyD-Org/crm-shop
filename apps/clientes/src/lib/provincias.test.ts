import { describe, expect, it } from "vitest";
import { PROVINCIAS_AR, provinciaCanonica } from "./provincias";

describe("PROVINCIAS_AR", () => {
  it("son las 24 jurisdicciones, sin repetidos", () => {
    expect(PROVINCIAS_AR).toHaveLength(24);
    expect(new Set(PROVINCIAS_AR).size).toBe(24);
    expect(PROVINCIAS_AR).toContain("Misiones");
    expect(PROVINCIAS_AR).toContain("Ciudad Autónoma de Buenos Aires");
    expect(PROVINCIAS_AR).toContain("Tierra del Fuego");
  });
});

describe("provinciaCanonica", () => {
  it("devuelve el nombre de la lista tolerando acentos, mayúsculas y espacios", () => {
    expect(provinciaCanonica("Misiones")).toBe("Misiones");
    expect(provinciaCanonica("  misiones ")).toBe("Misiones");
    expect(provinciaCanonica("cordoba")).toBe("Córdoba");
    expect(provinciaCanonica("ENTRE RIOS")).toBe("Entre Ríos");
  });

  it("entiende los nombres que devuelve el geocodificador", () => {
    expect(provinciaCanonica("Provincia de Misiones")).toBe("Misiones");
    expect(provinciaCanonica("CABA")).toBe("Ciudad Autónoma de Buenos Aires");
    expect(provinciaCanonica("Capital Federal")).toBe("Ciudad Autónoma de Buenos Aires");
    expect(
      provinciaCanonica("Tierra del Fuego, Antártida e Islas del Atlántico Sur"),
    ).toBe("Tierra del Fuego");
  });

  it("entiende el nombre oficial de Georef y las variantes de CABA y Tierra del Fuego", () => {
    expect(provinciaCanonica("Ciudad Autónoma de Buenos Aires")).toBe("Ciudad Autónoma de Buenos Aires");
    expect(provinciaCanonica("provincia de CORDOBA")).toBe("Córdoba");
    expect(provinciaCanonica("Tierra del Fuego, Antártida e Islas del Atlántico Sur")).toBe("Tierra del Fuego");
    expect(provinciaCanonica("Tierra del Fuego AeIAS")).toBe("Tierra del Fuego");
    expect(provinciaCanonica("Buenos Aires (CABA)")).toBe("Ciudad Autónoma de Buenos Aires");
    // Sin pasar por alias, la provincia "Buenos Aires" sigue siendo la provincia.
    expect(provinciaCanonica("Buenos Aires")).toBe("Buenos Aires");
  });

  it("null si no es una provincia argentina", () => {
    expect(provinciaCanonica("Alto Paraná")).toBeNull();
    expect(provinciaCanonica("")).toBeNull();
    expect(provinciaCanonica(null)).toBeNull();
  });
});
