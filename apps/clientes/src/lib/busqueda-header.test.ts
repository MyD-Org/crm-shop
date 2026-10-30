import { describe, expect, it } from "vitest";
import { busquedaAplicada } from "./busqueda-header";

const sp = (q: string) => new URLSearchParams(q);

describe("busquedaAplicada", () => {
  it("en el catálogo, la búsqueda de la URL", () => {
    expect(busquedaAplicada("/catalogo", sp("q=tira%20led&cat=ILUMINACION"))).toBe("tira led");
  });

  it("en el catálogo sin búsqueda, vacío", () => {
    expect(busquedaAplicada("/catalogo", sp("cat=ILUMINACION"))).toBe("");
  });

  it("fuera del catálogo, vacío aunque la URL traiga q", () => {
    expect(busquedaAplicada("/", sp(""))).toBe("");
    expect(busquedaAplicada("/producto/123", sp(""))).toBe("");
    expect(busquedaAplicada("/marcas/led-premium", sp("q=panel"))).toBe("");
  });

  it("sin ruta todavía, vacío", () => {
    expect(busquedaAplicada(null, sp("q=panel"))).toBe("");
  });
});
