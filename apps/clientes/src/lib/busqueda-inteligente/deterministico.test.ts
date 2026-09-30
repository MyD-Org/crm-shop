import { describe, expect, it } from "vitest";
import { deterministico, textoResidual, tokensDe } from "./deterministico";
import type { NodoArbol } from "./tipos";

/** Árbol de ejemplo con la forma del de Central LED (3 niveles, 2 raíces). */
const n = (id: string, nombre: string, parentId: string | null = null, orden = 0): NodoArbol => ({ id, parentId, nombre, orden });
const ARBOL: NodoArbol[] = [
  n("r1", "ILUMINACION", null, 1),
  n("r2", "MATERIALES ELECTRICOS", null, 2),
  n("c1", "Reflectores", "r1", 1),
  n("c2", "Tiras LED", "r1", 2),
  n("c3", "Lámparas", "r1", 3),
  n("c4", "Lámparas decorativas", "c3", 1),
  n("c5", "Cables", "r2", 1),
  n("c6", "Térmicas", "r2", 2),
  // Cuelga de una categoría que no está activa (no viene en el árbol): no cuenta.
  n("x1", "Huérfana", "inactiva", 1),
];

describe("deterministico: atributos", () => {
  it("sinónimos como palabra o frase completa", () => {
    expect(deterministico("reflector calido para exterior", ARBOL).atributos).toEqual(["tono-calido", "apto-exterior"]);
    expect(deterministico("lampara luz de dia e27", ARBOL).atributos).toEqual(["tono-frio", "zocalo-e27"]);
  });

  it("no dispara con una palabra que sólo contiene el sinónimo", () => {
    expect(deterministico("cable de calidad", ARBOL).atributos).toEqual([]);
    expect(deterministico("exteriorizar", ARBOL).atributos).toEqual([]);
  });
});

describe("deterministico: categorías", () => {
  it("el nombre de la categoría en singular o plural", () => {
    expect(deterministico("reflector calido", ARBOL).categorias).toEqual(["Reflectores"]);
    expect(deterministico("tiras para la cocina", ARBOL).categorias).toEqual(["Tiras LED"]);
    expect(deterministico("termica", ARBOL).categorias).toEqual(["Térmicas"]);
  });

  it("la más específica gana sobre su madre", () => {
    expect(deterministico("lamparas decorativas vintage", ARBOL).categorias).toEqual(["Lámparas decorativas"]);
  });

  it("una categoría que cuelga de una inactiva no cuenta", () => {
    expect(deterministico("huerfana", ARBOL).categorias).toEqual([]);
  });

  it("sin árbol, sólo atributos", () => {
    expect(deterministico("reflector calido", [])).toMatchObject({ categorias: [], atributos: ["tono-calido"] });
  });
});

describe("textoResidual", () => {
  it("quedan los tokens con dígitos que ningún atributo absorbió", () => {
    const r = deterministico("reflector led 50w calido 3000k", ARBOL);
    expect(textoResidual("reflector led 50w calido 3000k", r.absorbidos)).toBe("50w");
  });

  it("sin tokens con dígitos, la búsqueda se quita", () => {
    const r = deterministico("luz calida para el patio", ARBOL);
    expect(textoResidual("luz calida para el patio", r.absorbidos)).toBeUndefined();
  });

  it("tokens sin puntuación de borde", () => {
    expect(tokensDe("reflector, 50w.")).toEqual(["reflector", "50w"]);
  });
});
