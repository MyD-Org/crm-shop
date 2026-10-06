import { describe, expect, it } from "vitest";
import { LEXICO_CONTEXTO, PALABRAS_VACIAS } from "./residuo";

describe("vocabularios", () => {
  it("listas en minúsculas y sin tildes", () => {
    for (const p of [...PALABRAS_VACIAS, ...LEXICO_CONTEXTO]) expect(p).toBe(p.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
  });
});
