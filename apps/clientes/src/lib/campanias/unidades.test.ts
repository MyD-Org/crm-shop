import { describe, expect, it } from "vitest";
import type { EntradaCampania } from "./precio";
import { quedanDe, reglasConLimite } from "./unidades";

// Límite de unidades por regla de campaña (spec 2026-10-28-campanias-precios-design.md). Inventado.

const entrada = (reglaId: string, unidades: number | null, id = "c1"): EntradaCampania => ({
  id,
  reglaId,
  inicio: "2026-11-27T03:00:00.000Z",
  fin: "2026-12-01T03:00:00.000Z",
  pct: 20,
  unidades,
  precios: [{ idPriceList: "G", price: 128 }],
});

describe("reglasConLimite", () => {
  it("sólo las reglas con límite de las campañas activas, sin repetir", () => {
    const m = reglasConLimite([[entrada("r1", 5), entrada("r2", null)], [entrada("r1", 5)], [entrada("r3", 2, "otra")]], new Set(["c1"]));
    expect([...m.entries()]).toEqual([["r1", 5]]);
  });
});

describe("quedanDe", () => {
  it("límite 5 con 3 usadas: quedan 2", () => {
    expect(quedanDe(new Map([["r1", 5]]), new Map([["r1", 3]]))).toEqual(new Map([["r1", 2]]));
  });

  it("más usadas que el límite: 0, nunca negativo", () => {
    expect(quedanDe(new Map([["r1", 5]]), new Map([["r1", 6]]))).toEqual(new Map([["r1", 0]]));
  });

  it("sin ventas: todo el límite", () => {
    expect(quedanDe(new Map([["r1", 5]]), new Map())).toEqual(new Map([["r1", 5]]));
  });
});
