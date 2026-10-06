import { beforeEach, describe, expect, it, vi } from "vitest";

const contarCatalogo = vi.fn(async (opciones: unknown) => (opciones ? 7 : 0));
vi.mock("../catalog", () => ({ contarCatalogo: (o: unknown) => contarCatalogo(o) }));

import { contador } from "./conteo";
import type { Contar } from "./entender/combinar";

const base = { soloVisibles: false, soloStock: false, estructurados: true };

beforeEach(() => contarCatalogo.mockClear());

describe("contador", () => {
  it("pasa categorías y atributos como filtros duros y los términos como plan", async () => {
    const n = await contador(base)({ categorias: ["Termomagnéticas"], atributos: ["polos:2"], terminos: ["termica"] });
    expect(n).toBe(7);
    const { filtros } = contarCatalogo.mock.calls[0][0] as { filtros: Record<string, unknown> };
    expect(filtros).toMatchObject({ categorias: ["Termomagnéticas"], atributos: ["polos:2"], atributosEstructurados: true });
    expect(filtros.planBusqueda).toBeDefined();
    expect(filtros).not.toHaveProperty("medidasPositivas");
    expect(filtros).not.toHaveProperty("conClaves");
  });

  it("con `positivos` cuenta las medidas en modo positivo (sólo lo que cumple)", async () => {
    await contador({ ...base, positivos: true })({ categorias: [], atributos: ["corriente_a:20"] });
    const { filtros } = contarCatalogo.mock.calls[0][0] as { filtros: Record<string, unknown> };
    expect(filtros.medidasPositivas).toBe(true);
  });

  it("deja pasar `conClaves` (cobertura de una clave en el universo)", async () => {
    await contador(base)({ categorias: ["Termomagnéticas"], atributos: [], conClaves: ["polos"] });
    const { filtros } = contarCatalogo.mock.calls[0][0] as { filtros: Record<string, unknown> };
    expect(filtros.conClaves).toEqual(["polos"]);
  });

  it("sigue siendo un `Contar` para quien ya lo usa", () => {
    const contar: Contar = contador(base);
    expect(typeof contar).toBe("function");
  });

  it("sin estructurados no manda la marca (el catálogo ignora las medidas)", async () => {
    await contador({ ...base, estructurados: false })({ categorias: [], atributos: [] });
    const { filtros } = contarCatalogo.mock.calls[0][0] as { filtros: Record<string, unknown> };
    expect(filtros).not.toHaveProperty("atributosEstructurados");
  });
});
