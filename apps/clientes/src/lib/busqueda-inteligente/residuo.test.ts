import { describe, expect, it } from "vitest";
import { LEXICO_CONTEXTO, PALABRAS_VACIAS, residuoDeBusqueda, tokensSignificativos } from "./residuo";

describe("tokensSignificativos", () => {
  it("lo que ninguna categoría ni atributo tradujo y no es contexto ni palabra vacía", () => {
    expect(tokensSignificativos("lampara para pecera de agua salada", new Set(), ["Lámparas"])).toEqual(["pecera", "salada"]);
  });

  it("ambientes, clima, luz y verbos de pedido no cuentan", () => {
    expect(tokensSignificativos("luz para el jardin que no se moje", new Set(), ["Luminarias exteriores"])).toEqual([]);
    expect(tokensSignificativos("necesito algo potente para el galpon", new Set(), ["Reflectores"])).toEqual([]);
  });

  it("las palabras de la categoría aplicada (en singular) y las de un atributo quedan absorbidas", () => {
    expect(tokensSignificativos("reflectores para el patio luz calida", new Set(["calida"]), ["Reflectores"])).toEqual([]);
    expect(tokensSignificativos("reflector led calido", new Set(["calido"]), [])).toEqual(["reflector"]);
  });

  it("listas en minúsculas y sin tildes", () => {
    for (const p of [...PALABRAS_VACIAS, ...LEXICO_CONTEXTO]) expect(p).toBe(p.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
  });
});

describe("residuoDeBusqueda", () => {
  it("dígitos no absorbidos y significativos, en el orden de la consulta", () => {
    expect(residuoDeBusqueda("reflector 50w calido para pileta", new Set(["calido"]), ["Reflectores"])).toBe("50w");
    expect(residuoDeBusqueda("lampara 9w para pecera", new Set(), ["Lámparas"])).toBe("9w pecera");
  });

  it("sin nada que quede, undefined", () => {
    expect(residuoDeBusqueda("reflector para el patio luz calida", new Set(["calida"]), ["Reflectores"])).toBeUndefined();
  });
});
