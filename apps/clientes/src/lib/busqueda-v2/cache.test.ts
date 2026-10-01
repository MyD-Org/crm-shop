import { afterEach, describe, expect, it, vi } from "vitest";
import { Lru } from "./cache";
import { comoPlan, planVacio } from "./plan";

describe("LRU de planes", () => {
  it("guarda hasta el máximo y descarta el menos usado", () => {
    const lru = new Lru<number>(2, 1000);
    lru.set("a", 1, 0);
    lru.set("b", 2, 0);
    expect(lru.get("a", 1)).toBe(1); // "a" pasa a ser la más usada
    lru.set("c", 3, 2);
    expect(lru.get("b", 3)).toBeUndefined();
    expect(lru.get("a", 3)).toBe(1);
    expect(lru.get("c", 3)).toBe(3);
    expect(lru.size).toBe(2);
  });

  it("vence a la hora (TTL)", () => {
    const lru = new Lru<number>(10, 1000);
    lru.set("a", 1, 0);
    expect(lru.get("a", 999)).toBe(1);
    expect(lru.get("a", 2000)).toBeUndefined();
  });
});

describe("comoPlan (filas de la caché)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("acepta un plan versión 1 y descarta lo mal formado", () => {
    const p = { ...planVacio("luz"), blandos: { categorias: [{ nombre: "Tubos", peso: 0.5 }, { nombre: "", peso: 1 }], atributos: [{ id: "tono-frio", peso: 7 }], terminos: [{ texto: "luz", peso: 0.3 }] } };
    expect(comoPlan(p)).toEqual({ ...p, blandos: { categorias: [{ nombre: "Tubos", peso: 0.5 }], atributos: [], terminos: [{ texto: "luz", peso: 0.3 }] } });
  });

  it("ignora las filas de la fase 1 (sin version) y la basura", () => {
    expect(comoPlan({ aplicar: { categorias: ["Tubos"], atributos: [] }, sugerir: { categorias: [], atributos: [] } })).toBeNull();
    expect(comoPlan(null)).toBeNull();
    expect(comoPlan({ version: 1, consulta: "x", intencion: "otra" })).toBeNull();
  });
});
