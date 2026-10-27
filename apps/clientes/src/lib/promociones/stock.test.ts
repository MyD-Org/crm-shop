import { describe, expect, it } from "vitest";
import { disponibleEnSucursal, sucursalesDePromo } from "./stock";

describe("disponibleEnSucursal", () => {
  const bruta = {
    stockPorSucursal: { "1": { mdp: 10, igz: 3 }, "2": null },
    reservadoPorSucursal: { "1": { mdp: 2 } },
    ocultoEn: {},
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
