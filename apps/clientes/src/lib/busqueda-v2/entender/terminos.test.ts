import { describe, expect, it } from "vitest";
import { PESO_CONTEXTO, PESO_MEDIDA, terminosDe } from "./terminos";
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

  it("una frase sólo de contexto no deja nada que recupere", () => {
    expect(Object.values(peso("luz para el patio que no se moje")).every((p) => p < 0.6)).toBe(true);
  });
});
