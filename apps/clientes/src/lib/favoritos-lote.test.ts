import { describe, expect, it } from "vitest";
import { planificarLote } from "./favoritos-lote";

const rango = (n: number, desde = 1) => Array.from({ length: n }, (_, i) => String(desde + i));

describe("planificarLote", () => {
  it("198 + 5 => entran 2 en orden, 3 sin lugar", () => {
    const p = planificarLote(rango(198), rango(5, 1000), 200);
    expect(p.aEscribir).toEqual(["1000", "1001"]);
    expect(p.sinLugar).toBe(3);
    expect(p.yaEstaban).toBe(0);
  });

  it("los que ya estaban no consumen cupo", () => {
    const p = planificarLote(rango(199), ["1", "2", "900", "901"], 200);
    expect(p.aEscribir).toEqual(["900"]);
    expect(p.yaEstaban).toBe(2);
    expect(p.sinLugar).toBe(1);
  });

  it("200 + N => 0 entran", () => {
    const p = planificarLote(rango(200), rango(4, 1000), 200);
    expect(p).toEqual({ aEscribir: [], yaEstaban: 0, sinLugar: 4 });
  });

  it("idempotente: todos ya eran favoritos", () => {
    const p = planificarLote(["1", "2", "3"], ["1", "2", "3"], 200);
    expect(p).toEqual({ aEscribir: [], yaEstaban: 3, sinLugar: 0 });
  });

  it("199 + 3 => entra 1", () => {
    expect(planificarLote(rango(199), rango(3, 1000), 200).aEscribir).toEqual(["1000"]);
  });

  it("duplicados en el lote se cuentan una vez", () => {
    expect(planificarLote([], ["5", "5", "6"], 200).aEscribir).toEqual(["5", "6"]);
  });
});
