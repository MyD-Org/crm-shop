import { describe, expect, it } from "vitest";
import {
  POSICION_MAX,
  POSICION_MIN,
  posicionAPrecio,
  precioAPosicion,
  redondearLindo,
} from "./escala-precio";

describe("redondearLindo", () => {
  it("redondea al paso que corresponde a su magnitud", () => {
    expect(redondearLindo(0)).toBe(0);
    expect(redondearLindo(-5)).toBe(0);
    expect(redondearLindo(123)).toBe(100);
    expect(redondearLindo(480)).toBe(500);
    expect(redondearLindo(1234)).toBe(1000);
    expect(redondearLindo(4800)).toBe(5000);
    expect(redondearLindo(12345)).toBe(10000);
    expect(redondearLindo(2842886)).toBe(3000000);
  });
});

describe("posicionAPrecio / precioAPosicion — extremos", () => {
  const min = 488;
  const max = 2842886;

  it("la posición 0 es exactamente el mínimo", () => {
    expect(posicionAPrecio(POSICION_MIN, min, max)).toBe(min);
  });

  it("la posición máxima es exactamente el máximo", () => {
    expect(posicionAPrecio(POSICION_MAX, min, max)).toBe(max);
  });

  it("el precio mínimo mapea a la posición 0", () => {
    expect(precioAPosicion(min, min, max)).toBe(POSICION_MIN);
  });

  it("el precio máximo mapea a la posición máxima", () => {
    expect(precioAPosicion(max, min, max)).toBe(POSICION_MAX);
  });

  it("posiciones fuera de rango se acotan a los extremos", () => {
    expect(posicionAPrecio(-50, min, max)).toBe(min);
    expect(posicionAPrecio(POSICION_MAX + 50, min, max)).toBe(max);
  });

  it("precios fuera de rango se acotan a los extremos", () => {
    expect(precioAPosicion(min - 1000, min, max)).toBe(POSICION_MIN);
    expect(precioAPosicion(max + 1000, min, max)).toBe(POSICION_MAX);
  });
});

describe("posicionAPrecio / precioAPosicion — ida y vuelta", () => {
  const min = 488;
  const max = 2842886;

  it("una posición intermedia vuelve a una posición cercana tras el redondeo", () => {
    for (const pos of [1, 100, 250, 500, 750, 900, 999]) {
      const precio = posicionAPrecio(pos, min, max);
      const posicionDeVuelta = precioAPosicion(precio, min, max);
      // El redondeo "lindo" del precio pierde precisión; la posición de
      // vuelta debe quedar cerca (no exacta) de la original.
      expect(Math.abs(posicionDeVuelta - pos)).toBeLessThanOrEqual(25);
    }
  });

  it("un precio cualquiera del rango vuelve a un precio cercano tras la ida y vuelta", () => {
    for (const precio of [1000, 50000, 300000, 1500000]) {
      const posicion = precioAPosicion(precio, min, max);
      const precioDeVuelta = posicionAPrecio(posicion, min, max);
      // Tolerancia relativa: el paso "lindo" en esa magnitud.
      expect(Math.abs(precioDeVuelta - precio) / precio).toBeLessThan(0.15);
    }
  });

  it("la escala es monótona: a mayor posición, precio mayor o igual", () => {
    let anterior = posicionAPrecio(0, min, max);
    for (let pos = 50; pos <= POSICION_MAX; pos += 50) {
      const precio = posicionAPrecio(pos, min, max);
      expect(precio).toBeGreaterThanOrEqual(anterior);
      anterior = precio;
    }
  });
});

describe("rango degenerado (min === max)", () => {
  it("cualquier posición da el único precio posible", () => {
    expect(posicionAPrecio(0, 5000, 5000)).toBe(5000);
    expect(posicionAPrecio(500, 5000, 5000)).toBe(5000);
    expect(posicionAPrecio(POSICION_MAX, 5000, 5000)).toBe(5000);
  });

  it("cualquier precio da la posición mínima", () => {
    expect(precioAPosicion(5000, 5000, 5000)).toBe(POSICION_MIN);
  });
});

describe("mínimo en $0", () => {
  const min = 0;
  const max = 100000;

  it("no da NaN ni Infinity y respeta los extremos", () => {
    expect(posicionAPrecio(POSICION_MIN, min, max)).toBe(0);
    expect(posicionAPrecio(POSICION_MAX, min, max)).toBe(max);
    expect(precioAPosicion(0, min, max)).toBe(POSICION_MIN);
    expect(precioAPosicion(max, min, max)).toBe(POSICION_MAX);
    for (const pos of [1, 250, 500, 999]) {
      const precio = posicionAPrecio(pos, min, max);
      expect(Number.isFinite(precio)).toBe(true);
      expect(precio).toBeGreaterThanOrEqual(0);
      expect(precio).toBeLessThanOrEqual(max);
    }
  });
});
