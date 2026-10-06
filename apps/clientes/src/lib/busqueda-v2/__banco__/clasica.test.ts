import { beforeEach, describe, expect, it, vi } from "vitest";

const getPaginaCatalogo = vi.fn();
const consultarJev = vi.fn();
vi.mock("@/lib/catalog", () => ({ getPaginaCatalogo: (...a: unknown[]) => getPaginaCatalogo(...a) }));
vi.mock("@/lib/busqueda-inteligente/jev", () => ({ consultarJev: (...a: unknown[]) => consultarJev(...a) }));

import { ejecutarClasica } from "./clasica";
import { VISTA_ACTUAL, vistaProduccion } from "./vista";

const pagina = (n: number) => ({
  productos: Array.from({ length: n }, (_, i) => ({ name: `producto ${i}`, categoriaPropiaId: "c1" })),
  total: n,
  pagina: 1,
  paginas: 1,
});

beforeEach(() => {
  getPaginaCatalogo.mockReset();
  consultarJev.mockReset();
  getPaginaCatalogo.mockResolvedValue(pagina(2));
});

describe("ejecutarClasica", () => {
  it("clásica: AND por palabra, sin tolerancia, sin plan, relevancia, página 1, vista actual", async () => {
    await ejecutarClasica("cinta ledd", {}, { tolerante: false });
    expect(getPaginaCatalogo).toHaveBeenCalledTimes(1);
    const opts = getPaginaCatalogo.mock.calls[0][0];
    expect(opts).toMatchObject({ soloVisibles: false, orden: "relevancia", pagina: 1 });
    expect(opts.filtros.texto).toEqual({ q: "cinta ledd" });
    expect(opts.filtros.soloStock).toBe(false);
  });

  it("tolerante: agrega sólo `tolerante` al texto y sigue sin plan", async () => {
    await ejecutarClasica("cinta ledd", {}, { tolerante: true });
    const { filtros } = getPaginaCatalogo.mock.calls[0][0];
    expect(filtros.texto).toEqual({ q: "cinta ledd", tolerante: true });
    expect(getPaginaCatalogo).toHaveBeenCalledTimes(1);
  });

  it("la vista de producción pasa soloVisibles y el stock por defecto", async () => {
    await ejecutarClasica("lampara", { vista: vistaProduccion(true) }, { tolerante: false });
    const opts = getPaginaCatalogo.mock.calls[0][0];
    expect(opts.soloVisibles).toBe(true);
    expect(opts.filtros.soloStock).toBe(true);
  });

  it("sin vista usa VISTA_ACTUAL", async () => {
    await ejecutarClasica("lampara", {}, { tolerante: false });
    const a = getPaginaCatalogo.mock.calls[0][0];
    getPaginaCatalogo.mockClear();
    await ejecutarClasica("lampara", { vista: VISTA_ACTUAL }, { tolerante: false });
    expect(getPaginaCatalogo.mock.calls[0][0]).toEqual(a);
  });

  it("no hay segundo intento aunque el resultado sea vacío, y jamás se llama a Jev", async () => {
    getPaginaCatalogo.mockResolvedValue(pagina(0));
    const r = await ejecutarClasica("zzzz", {}, { tolerante: false });
    expect(getPaginaCatalogo).toHaveBeenCalledTimes(1);
    expect(consultarJev).not.toHaveBeenCalled();
    expect(r.total).toBe(0);
  });

  it("resultado: intención undefined y categorías, atributos y expansiones vacíos", async () => {
    const r = await ejecutarClasica("lampara", {}, { tolerante: false });
    expect(r.intencion).toBeUndefined();
    expect(r.categoriasDuras).toEqual([]);
    expect(r.categoriasBlandas).toEqual([]);
    expect(r.atributosDuros).toEqual([]);
    expect(r.expansiones).toEqual([]);
    expect(r.productos).toHaveLength(2);
    expect(r.total).toBe(2);
    expect(typeof r.ms).toBe("number");
  });
});
