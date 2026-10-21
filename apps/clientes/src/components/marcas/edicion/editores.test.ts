import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/home-acciones", () => ({}));
vi.mock("@/lib/marcas/marcas-acciones", () => ({}));

import { BLOQUES_MARCA } from "@/lib/marcas/pagina-marca";
import { EDITORES_MARCA, TITULOS_BLOQUE } from "./editores";

describe("EDITORES_MARCA", () => {
  it("cubre los 8 bloques, cada uno con su título", () => {
    expect(Object.keys(EDITORES_MARCA).sort()).toEqual([...BLOQUES_MARCA].sort());
    for (const b of BLOQUES_MARCA) {
      expect(typeof EDITORES_MARCA[b]).toBe("function");
      expect(TITULOS_BLOQUE[b]).toBeTruthy();
    }
  });
});
