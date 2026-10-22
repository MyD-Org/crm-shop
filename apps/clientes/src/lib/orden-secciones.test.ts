import { describe, expect, it } from "vitest";
import { completarOrden, errorOrden, moverEnOrden } from "./orden-secciones";

const DEFECTO = ["a", "b", "c", "d"] as const;

describe("completarOrden", () => {
  it("sin orden guardado: el de código", () => {
    expect(completarOrden(undefined, DEFECTO)).toEqual(["a", "b", "c", "d"]);
    expect(completarOrden("basura", DEFECTO)).toEqual(["a", "b", "c", "d"]);
  });

  it("respeta el orden guardado", () => {
    expect(completarOrden(["d", "c", "b", "a"], DEFECTO)).toEqual(["d", "c", "b", "a"]);
  });

  it("descarta desconocidas y repetidas", () => {
    expect(completarOrden(["c", "zzz", "c", "a", "b", "d"], DEFECTO)).toEqual(["c", "a", "b", "d"]);
  });

  it("una sección nueva (que no estaba al guardar) entra después de la que la precede en el código", () => {
    // Se guardó cuando no existía "c": entra justo después de "b".
    expect(completarOrden(["d", "b", "a"], DEFECTO)).toEqual(["d", "b", "c", "a"]);
    // La primera del código, si falta, va al principio.
    expect(completarOrden(["c", "b", "d"], DEFECTO)).toEqual(["a", "c", "b", "d"]);
  });
});

describe("moverEnOrden", () => {
  it("sube y baja una posición; en los bordes no cambia", () => {
    expect(moverEnOrden(["a", "b", "c"], "b", "arriba")).toEqual(["b", "a", "c"]);
    expect(moverEnOrden(["a", "b", "c"], "b", "abajo")).toEqual(["a", "c", "b"]);
    expect(moverEnOrden(["a", "b", "c"], "a", "arriba")).toEqual(["a", "b", "c"]);
    expect(moverEnOrden(["a", "b", "c"], "c", "abajo")).toEqual(["a", "b", "c"]);
  });
});

describe("errorOrden (lo que llega del editor)", () => {
  it("válido: una permutación de las conocidas", () => {
    expect(errorOrden(["b", "a", "d", "c"], DEFECTO)).toBeNull();
  });
  it("rechaza lo que no es lista, desconocidas, repetidas o incompletas", () => {
    expect(errorOrden("a", DEFECTO)).not.toBeNull();
    expect(errorOrden(["a", "b", "c", "x"], DEFECTO)).not.toBeNull();
    expect(errorOrden(["a", "a", "b", "c"], DEFECTO)).not.toBeNull();
    expect(errorOrden(["a", "b"], DEFECTO)).not.toBeNull();
  });
});
