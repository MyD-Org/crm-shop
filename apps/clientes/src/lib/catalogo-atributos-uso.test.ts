import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

const disponibles = vi.fn(async () => true);
vi.mock("./catalogo-atributos-disponibles", () => ({ atributosEstructuradosDisponibles: () => disponibles() }));

import { usarAtributosEstructurados } from "./catalogo-atributos-uso";

beforeEach(() => {
  disponibles.mockClear();
});

describe("usarAtributosEstructurados: flag busqueda-ia Y tabla disponible", () => {
  it("flag apagado ⇒ false sin consultar la base", async () => {
    setFlag("busqueda-ia", false);
    expect(await usarAtributosEstructurados()).toBe(false);
    expect(disponibles).not.toHaveBeenCalled();
  });

  it("flag prendido ⇒ lo que diga la tabla", async () => {
    setFlag("busqueda-ia", true);
    expect(await usarAtributosEstructurados()).toBe(true);
    disponibles.mockResolvedValueOnce(false);
    expect(await usarAtributosEstructurados()).toBe(false);
  });
});
