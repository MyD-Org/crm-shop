import { describe, expect, it, vi } from "vitest";

const leerSinCache = vi.hoisted(() => vi.fn(async () => {
  throw new Error("lectura sin caché");
}));
const cacheadas = vi.hoisted(() => vi.fn());
const bruta = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sucursales-repo", () => ({ leerSucursalesYZonas: leerSinCache }));
vi.mock("@/lib/sucursales-datos", () => ({ sucursalesCacheadas: cacheadas }));
vi.mock("@/lib/stock-sucursal", () => ({ leerDisponibilidadBruta: bruta }));

import { disponibleEnSucursal, quedanEstrella, sucursalesDePromo } from "./stock";

describe("disponibleEnSucursal", () => {
  const bruta = {
    stockPorSucursal: { "1": { mdp: 10, igz: 3 }, "2": null },
    reservadoPorSucursal: { "1": { mdp: 2 } },
    ocultoEn: {},
    ventaSinStock: {},
  };

  it("stock menos lo reservado en esa sucursal", () => {
    expect(disponibleEnSucursal(bruta, ["1"], "mdp")).toEqual({ "1": 8 });
  });

  it("nunca negativo", () => {
    const b = { ...bruta, reservadoPorSucursal: { "1": { igz: 9 } } };
    expect(disponibleEnSucursal(b, ["1"], "igz")).toEqual({ "1": 0 });
  });

  it("un id sin fila da 0", () => {
    expect(disponibleEnSucursal(bruta, ["9"], "mdp")).toEqual({ "9": 0 });
  });

  it("un producto no inventariable da null", () => {
    expect(disponibleEnSucursal(bruta, ["2"], "mdp")).toEqual({ "2": null });
  });
});

describe("sucursalesDePromo", () => {
  it("sólo las activas, en orden, con la primera como predeterminada", () => {
    const r = sucursalesDePromo([
      { slug: "igz", nombre: "Puerto Iguazú", activa: true, orden: 1 },
      { slug: "mdp", nombre: "Mar del Plata", activa: true, orden: 0 },
      { slug: "vieja", nombre: "Cerrada", activa: false, orden: 2 },
    ]);
    expect(r).toEqual([
      { slug: "mdp", nombre: "Mar del Plata", predeterminada: true },
      { slug: "igz", nombre: "Puerto Iguazú", predeterminada: false },
    ]);
  });
});

describe("quedanEstrella", () => {
  it("lee las sucursales de la caché (no de la base en cada vista)", async () => {
    cacheadas.mockResolvedValue({
      sucursales: [{ slug: "mdp", nombre: "Mar del Plata", activa: true, orden: 0 }],
      zonas: [],
    });
    bruta.mockResolvedValue({ stockPorSucursal: { "7": { mdp: 8 } }, reservadoPorSucursal: {}, ocultoEn: {}, ventaSinStock: {} });
    expect(await quedanEstrella({ sku: "NK-1", unidadesPromo: 5, stockBase: 10 }, "7")).toBe(3);
    expect(bruta).toHaveBeenCalledWith(["7"], ["mdp"], "mdp");
    expect(leerSinCache).not.toHaveBeenCalled();
  });
});
