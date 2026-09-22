import { describe, expect, it } from "vitest";
import { cambiarBorrador, hrefAlAplicar, limpiarBorrador } from "./catalogo-borrador";
import type { EstadoCatalogo } from "./catalogo-url";

const base: EstadoCatalogo = {
  query: undefined,
  categorias: [],
  marcas: [],
  orden: "nombre",
  pagina: 1,
  soloStock: false,
  vista: "grilla",
};

describe("cambiarBorrador", () => {
  it("acumula cambios sin navegar: el borrador es un estado completo", () => {
    let b = cambiarBorrador(base, { marcas: ["GENROD"] });
    b = cambiarBorrador(b, { soloStock: true });
    expect(b).toEqual({ ...base, marcas: ["GENROD"], soloStock: true });
  });

  it("un cambio con undefined borra el valor (quitar el rango de precio)", () => {
    const b = cambiarBorrador(
      { ...base, precioMin: 500, precioMax: 9000 },
      { precioMin: undefined, precioMax: undefined }
    );
    expect(b.precioMin).toBeUndefined();
    expect(b.precioMax).toBeUndefined();
  });

  it("no muta el borrador anterior", () => {
    const antes = { ...base, marcas: ["GENROD"] };
    cambiarBorrador(antes, { marcas: [] });
    expect(antes.marcas).toEqual(["GENROD"]);
  });
});

describe("limpiarBorrador", () => {
  it("vacía los filtros y conserva búsqueda, orden y vista", () => {
    const b = limpiarBorrador({
      ...base,
      query: "led",
      orden: "precio-asc",
      vista: "lista",
      pagina: 4,
      categorias: ["ILUMINACION"],
      marcas: ["GENROD"],
      precioMin: 500,
      soloStock: true,
    });
    expect(b).toEqual({
      ...base,
      query: "led",
      orden: "precio-asc",
      vista: "lista",
      pagina: 4,
      precioMin: undefined,
      precioMax: undefined,
    });
  });
});

describe("hrefAlAplicar", () => {
  it("scenario MOB-2 aplicar: una sola URL con todo el borrador", () => {
    const b = cambiarBorrador(cambiarBorrador(base, { marcas: ["GENROD"] }), {
      soloStock: true,
    });
    expect(hrefAlAplicar(base, b)).toBe("/catalogo?marca=GENROD&stock=1");
  });

  it("vuelve a la página 1 y conserva búsqueda, orden y vista de la URL", () => {
    const estado = { ...base, query: "led", orden: "precio-desc" as const, vista: "lista" as const, pagina: 7 };
    const b = cambiarBorrador(estado, { categorias: ["ILUMINACION"] });
    expect(hrefAlAplicar(estado, b)).toBe(
      "/catalogo?q=led&categoria=ILUMINACION&orden=precio-desc&vista=lista"
    );
  });

  it("sin cambios de filtros devuelve null (cerrar sin navegar)", () => {
    const estado = { ...base, marcas: ["GENROD"], pagina: 3 };
    expect(hrefAlAplicar(estado, { ...estado })).toBeNull();
  });

  it("el orden de los tildados no cuenta como cambio", () => {
    const estado = { ...base, marcas: ["GENROD", "MACROLED"] };
    expect(hrefAlAplicar(estado, { ...estado, marcas: ["MACROLED", "GENROD"] })).toBeNull();
  });

  it("limpiar en el borrador y aplicar borra los filtros de la URL", () => {
    const estado = { ...base, categorias: ["ILUMINACION"], precioMin: 500, soloStock: true };
    expect(hrefAlAplicar(estado, limpiarBorrador(estado))).toBe("/catalogo");
  });
});
