import { describe, expect, it } from "vitest";
import { alternarCar, cambiosDeCarRango, carDeClave, rangoDeCar } from "./catalogo-car";

describe("alternarCar (lista: OR dentro de la clave)", () => {
  it("tilda un valor sumándolo a la lista", () => {
    expect(alternarCar([], "polos", "2", true)).toEqual(["polos:2"]);
    expect(alternarCar(["polos:2", "curva:c"], "polos", "4", true)).toEqual(["polos:2", "polos:4", "curva:c"]);
  });

  it("destilda quitando solo ese valor", () => {
    expect(alternarCar(["polos:2", "polos:4", "curva:c"], "polos", "2", false)).toEqual(["polos:4", "curva:c"]);
  });

  it("tildar dos veces el mismo valor no lo repite", () => {
    expect(alternarCar(["polos:2"], "polos", "2", true)).toEqual(["polos:2"]);
  });

  it("un valor que no pasa la gramática no se agrega", () => {
    expect(alternarCar([], "polos", "99", true)).toEqual([]);
    expect(alternarCar([], "desconocida", "x", true)).toEqual([]);
  });
});

describe("carDeClave", () => {
  it("devuelve los valores tildados de una clave de lista", () => {
    expect(carDeClave(["polos:2", "polos:4", "curva:c"], "polos")).toEqual(["2", "4"]);
    expect(carDeClave(["curva:c"], "polos")).toEqual([]);
  });
});

describe("rango en car (flujo luminoso, largo)", () => {
  it("rangoDeCar lee el rango tildado de la clave, o undefined", () => {
    expect(rangoDeCar(["flujo_lm:800-1200"], "flujo_lm")).toEqual([800, 1200]);
    expect(rangoDeCar(["polos:2"], "flujo_lm")).toBeUndefined();
  });

  it("un rango que no coincide con los límites reales viaja como car, y reemplaza al anterior", () => {
    const limites = { min: 100, max: 5000 };
    expect(cambiosDeCarRango(["polos:2"], "flujo_lm", [800, 1200], limites)).toEqual(["polos:2", "flujo_lm:800-1200"]);
    expect(cambiosDeCarRango(["flujo_lm:800-1200", "polos:2"], "flujo_lm", [900, 1500], limites)).toEqual([
      "polos:2",
      "flujo_lm:900-1500",
    ]);
  });

  it("el rango completo es 'sin filtro': se quita el car de la clave", () => {
    const limites = { min: 100, max: 5000 };
    expect(cambiosDeCarRango(["flujo_lm:800-1200", "polos:2"], "flujo_lm", [100, 5000], limites)).toEqual(["polos:2"]);
  });

  it("un solo extremo en su límite igual viaja con los dos extremos", () => {
    expect(cambiosDeCarRango([], "flujo_lm", [100, 900], { min: 100, max: 5000 })).toEqual(["flujo_lm:100-900"]);
  });

  it("los extremos se acotan al rango válido de la clave (largo mínimo 0,1 m)", () => {
    expect(cambiosDeCarRango([], "largo_m", [0, 5], { min: 0, max: 50 })).toEqual(["largo_m:0.1-5"]);
  });

  it("los extremos van con a lo sumo dos decimales (el ruido de punto flotante del slider no llega a la URL)", () => {
    expect(cambiosDeCarRango([], "largo_m", [0.30000000000000004, 5], { min: 0, max: 50 })).toEqual(["largo_m:0.3-5"]);
  });

  it("extremos iguales (rango degenerado) no filtran", () => {
    expect(cambiosDeCarRango(["flujo_lm:800-1200"], "flujo_lm", [900, 900], { min: 100, max: 5000 })).toEqual([]);
  });
});
