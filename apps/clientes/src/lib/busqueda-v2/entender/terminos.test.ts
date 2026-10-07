import { describe, expect, it } from "vitest";
import { PESO_CONTEXTO, PESO_MEDIDA, esLugar, terminosDe, terminosDeFrase } from "./terminos";
import { PESO_EXPANSION } from "./sinonimos";

const peso = (q: string, absorbidos: string[] = []) =>
  Object.fromEntries(terminosDe(q, new Set(absorbidos)).map((t) => [t.texto, t.peso]));

describe("términos con peso", () => {
  it("vacías afuera, contexto y medidas sólo ordenan, el resto recupera", () => {
    expect(peso("cable para toma cocina")).toEqual({
      cable: 1,
      toma: 1,
      cocina: PESO_CONTEXTO,
      tomacorriente: PESO_EXPANSION,
    });
    expect(peso("termica 20 amperes")).toMatchObject({ termica: 1, "20": PESO_MEDIDA, amperes: PESO_CONTEXTO });
  });

  it("los absorbidos por un atributo explícito no quedan como texto", () => {
    expect(peso("foco calido e27", ["calido", "e27"])).toEqual({ foco: 1, lampara: PESO_EXPANSION, bulbo: PESO_EXPANSION });
  });

  it("lo que se ilumina o se mira es contexto («iluminar un cartel», «ver la casa»)", () => {
    expect(peso("iluminar un cartel de noche")).toEqual({ iluminar: PESO_CONTEXTO, cartel: PESO_CONTEXTO, noche: PESO_CONTEXTO });
    expect(peso("camara para ver la casa desde el celular")).toMatchObject({ camara: 1, casa: PESO_CONTEXTO, celular: 1 });
  });

  it("los operadores de rango («hasta», «menos de», «desde») son contexto: la medida decide, no recuperan", () => {
    expect(peso("hasta 50w")).toEqual({ hasta: PESO_CONTEXTO, "50w": PESO_MEDIDA });
    expect(peso("lampara de menos de 10w")).toEqual({ lampara: 1, menos: PESO_CONTEXTO, "10w": PESO_MEDIDA });
    expect(peso("reflector de mas de 100w")).toEqual({ reflector: 1, proyector: PESO_EXPANSION, "100w": PESO_MEDIDA });
  });

  it("una frase sólo de contexto no deja nada que recupere", () => {
    expect(Object.values(peso("luz para el patio que no se moje")).every((p) => p < 0.6)).toBe(true);
  });
});

describe("palabras que nombran un tipo de producto no son contexto", () => {
  it.each(["escritorio", "mesa", "techo", "pared", "piso"])("«%s» recupera y ordena con peso 1", (palabra) => {
    expect(peso(`lampara de ${palabra}`)).toMatchObject({ lampara: 1, [palabra]: 1 });
  });

  it("los casos del banco que las usan", () => {
    expect(peso("ventilador de techo con luz")).toMatchObject({ ventilador: 1, techo: 1, luz: PESO_CONTEXTO });
    expect(peso("spot para embutir en el techo")).toMatchObject({ spot: 1, embutir: 1, techo: 1 });
    expect(peso("lampara para leer en la mesa de luz")).toMatchObject({ lampara: 1, leer: PESO_CONTEXTO, mesa: 1, luz: PESO_CONTEXTO });
    // «pie» ya era significativo: «lampara de pie» no cambia.
    expect(peso("lampara de pie")).toMatchObject({ lampara: 1, pie: 1 });
  });

  it("los lugares siguen siendo contexto: «luz para el patio» y «iluminar un cartel de noche» no cambian", () => {
    expect(peso("luz para el patio")).toEqual({ luz: PESO_CONTEXTO, patio: PESO_CONTEXTO });
    expect(peso("lampara de jardin")).toMatchObject({ lampara: 1, jardin: PESO_CONTEXTO });
    expect(esLugar("jardines")).toBe(true);
    expect(esLugar("escritorio")).toBe(false);
  });
});

describe("terminosDeFrase", () => {
  const frase = (q: string) => terminosDeFrase(terminosDe(q));

  it("las significativas y los lugares, en el orden de la consulta", () => {
    expect(frase("lampara de escritorio")).toEqual(["lampara", "escritorio"]);
    expect(frase("lampara de jardin")).toEqual(["lampara", "jardin"]);
  });

  it("no cuenta el contexto de pedido, las medidas ni las expansiones", () => {
    expect(frase("quiero una lampara")).toEqual(["lampara"]);
    expect(frase("lampara led 20")).toEqual(["lampara"]);
    // Lo que tomó un atributo explícito tampoco forma parte de la frase.
    expect(terminosDeFrase(terminosDe("foco calido e27", new Set(["calido", "e27"])))).toEqual(["foco"]);
  });
});
