import { describe, expect, it } from "vitest";
import { elegirDestacados } from "./destacados";
import type { Product } from "@/data/products";

function p(id: string, name: string, sku?: string): Product {
  return {
    id,
    name,
    brand: "MACROLED",
    price: 1000,
    stock: "in",
    sku,
  };
}

describe("elegirDestacados", () => {
  const pool = [
    p("1", "ACL-0010-ESC-2"),
    p("2", "ADF-D8-BCO-CO"),
    p("3", "Panel LED", "ADM-D10-BCO-CO"),
    p("4", "ADM-D8-BCO-CO"),
    p("5", "Cable 2,5mm"),
  ];

  it("los skus curados van primero, en orden, y completa desde el pool", () => {
    const r = elegirDestacados(pool, ["ADM-D8-BCO-CO", "ADF-D8-BCO-CO"], 4);
    expect(r.map((x) => x.id)).toEqual(["4", "2", "1", "3"]);
  });

  it("matchea tanto por sku como por nombre (mayúsculas y espacios)", () => {
    const r = elegirDestacados(pool, [" adm-d10-bco-co "], 1);
    expect(r[0].id).toBe("3");
  });

  it("los skus inexistentes se saltan sin romper", () => {
    const r = elegirDestacados(pool, ["NO-EXISTE", "ADF-D8-BCO-CO"], 2);
    expect(r.map((x) => x.id)).toEqual(["2", "1"]);
  });

  it("sin skus, toma los primeros del pool", () => {
    const r = elegirDestacados(pool, [], 3);
    expect(r.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  it("respeta la cantidad aunque falten productos", () => {
    expect(elegirDestacados(pool, [], 99).length).toBe(pool.length);
  });

  it("SKU inexistente no rompe: devuelve cantidad productos sin lanzar (rebanada D)", () => {
    expect(() => elegirDestacados(pool, ["NO-EXISTE"], 4)).not.toThrow();
    expect(elegirDestacados(pool, ["NO-EXISTE"], 4).length).toBe(4);
  });

  it("respeta el orden guardado de los skus curados (rebanada D)", () => {
    const r = elegirDestacados(pool, ["ADM-D10-BCO-CO", "ADF-D8-BCO-CO", "ADM-D8-BCO-CO"], 3);
    expect(r.map((x) => x.id)).toEqual(["3", "2", "4"]);
  });
});
