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

  it("palabras de la calle del rubro: tira, decorativa, ajustar, luz de mesa, celu", () => {
    expect(expansiones(["tira", "led"], "tira de led")).toEqual(["neon"]);
    expect(expansiones(["neon"], "neon")).toEqual(["tira"]);
    expect(expansiones(["tira", "neon"], "tira neon")).toEqual([]);
    expect(expansiones(["decorativa"], "luz decorativa")).toEqual(["filamento", "vintage", "guirnalda"]);
    expect(expansiones(["decorativo"], "decorativo")).toEqual(["filamento", "vintage", "guirnalda"]);
    for (const verbo of ["ajustar", "ajustador", "apretar"]) {
      expect(expansiones([verbo, "tornillo"], `${verbo} tornillo`)).toEqual(["destornill", "atornill"]);
    }
    expect(expansiones(["luz", "mesa"], "luz de mesa")).toEqual(["velador"]);
    expect(expansiones(["foco", "celu"], "foco para usar desde el celu")).toEqual(
      expect.arrayContaining(["lampara", "bulbo", "wifi", "smart", "inteligente"]),
    );
  });

  it("«deco» (línea de teclas) no expande ni es destino: no arrastra interruptores a «decorativa»", () => {
    expect(Object.hasOwn(SINONIMOS, "deco")).toBe(false);
    expect(Object.values(SINONIMOS).flat()).not.toContain("deco");
  });
});
