import { describe, expect, it } from "vitest";
import {
  estadoConCambios,
  estadoDeBusqueda,
  filtrosDesfasados,
  hrefCanonico,
  hrefCatalogo,
  hrefCon,
  leerEstado,
  sinCar,
  type EstadoCatalogo,
} from "./catalogo-url";

const base: EstadoCatalogo = {
  query: undefined,
  categorias: [],
  marcas: [],
  atributos: [],
  caracteristicas: [],
  orden: "destacados",
  pagina: 1,
  soloStock: true,
  vista: "grilla",
};

describe("características por tipo (?car=, change catalogo-filtros-ux)", () => {
  it("lee los ids válidos en el orden del registro y descarta lo inválido", () => {
    expect(leerEstado({ car: ["curva:c", "polos:2", "polos:99", "desconocida:1", "polos:2;drop"] }).caracteristicas).toEqual([
      "polos:2",
      "curva:c",
    ]);
    expect(leerEstado({ car: "polos:2" }).caracteristicas).toEqual(["polos:2"]);
    expect(leerEstado({}).caracteristicas).toEqual([]);
  });

  it("se lee igual desde el browser (estadoDeBusqueda)", () => {
    expect(estadoDeBusqueda(new URLSearchParams("car=polos:4&car=polos:2")).caracteristicas).toEqual(["polos:2", "polos:4"]);
  });

  it("viaja en la URL después de atr y antes del precio, en orden fijo, y vuelve a leerse igual", () => {
    const estado = { ...base, categorias: ["TERMICAS"], atributos: ["tono-calido"], caracteristicas: ["polos:2", "polos:4", "curva:c"], precioMax: 9000 };
    const href = hrefCatalogo(estado);
    expect(href).toBe("/catalogo?categoria=TERMICAS&atr=tono-calido&car=polos%3A2&car=polos%3A4&car=curva%3Ac&precio_max=9000");
    const releido = estadoDeBusqueda(new URLSearchParams(href.split("?")[1]));
    expect(releido.caracteristicas).toEqual(["polos:2", "polos:4", "curva:c"]);
    expect(hrefCatalogo(releido)).toBe(href);
  });

  it("sin car la URL queda como siempre", () => {
    expect(hrefCatalogo(base)).toBe("/catalogo");
  });

  it("no entra al canonical", () => {
    expect(hrefCanonico({ ...base, categorias: ["TERMICAS"], caracteristicas: ["polos:2"] })).toBe("/catalogo?categoria=TERMICAS");
  });

  it("cambiar la categoría o la búsqueda descarta car; marca, precio, stock y página lo conservan", () => {
    const e = { ...base, categorias: ["TERMICAS"], caracteristicas: ["polos:2"] };
    expect(estadoConCambios(e, { categorias: ["LLAVES"] }).caracteristicas).toEqual([]);
    expect(estadoConCambios(e, { categorias: [] }).caracteristicas).toEqual([]);
    expect(estadoConCambios(e, { query: "llave" }).caracteristicas).toEqual([]);
    expect(estadoConCambios(e, { marcas: ["MARCA"] }).caracteristicas).toEqual(["polos:2"]);
    expect(estadoConCambios(e, { precioMax: 100 }).caracteristicas).toEqual(["polos:2"]);
    expect(estadoConCambios(e, { soloStock: false }).caracteristicas).toEqual(["polos:2"]);
    expect(estadoConCambios(e, { pagina: 3 }).caracteristicas).toEqual(["polos:2"]);
  });

  it("la misma categoría (otro orden) o la misma búsqueda no descarta car", () => {
    const e = { ...base, query: "termica", categorias: ["A", "B"], caracteristicas: ["polos:2"] };
    expect(estadoConCambios(e, { categorias: ["B", "A"] }).caracteristicas).toEqual(["polos:2"]);
    expect(estadoConCambios(e, { query: "termica" }).caracteristicas).toEqual(["polos:2"]);
  });

  it("un cambio que trae sus propios car los respeta aunque cambie la categoría", () => {
    const e = { ...base, categorias: ["TERMICAS"], caracteristicas: ["polos:2"] };
    expect(estadoConCambios(e, { categorias: ["LLAVES"], caracteristicas: ["color:blanco"] }).caracteristicas).toEqual(["color:blanco"]);
  });

  it("hrefCon: al cambiar de categoría no emite car; al tildar una marca sí", () => {
    const e = { ...base, categorias: ["TERMICAS"], caracteristicas: ["polos:2"] };
    expect(hrefCon(e, { categorias: ["LLAVES"] })).toBe("/catalogo?categoria=LLAVES");
    expect(hrefCon(e, { marcas: ["X"] })).toBe("/catalogo?categoria=TERMICAS&marca=X&car=polos%3A2");
  });

  it("filtrosDesfasados compara los car (el parámetro repetible que Next reduce al último)", () => {
    const renderizado = { ...base, caracteristicas: ["polos:2", "polos:4"] };
    expect(filtrosDesfasados(renderizado, new URLSearchParams("car=polos:2"), true, true)).toBe(true);
    expect(filtrosDesfasados(renderizado, new URLSearchParams("car=polos:2&car=polos:4"), true, true)).toBe(false);
  });

  it("con las facetas por tipo apagadas el car de la URL se ignora: no hay desfase", () => {
    expect(filtrosDesfasados(base, new URLSearchParams("car=polos:2"), true, false)).toBe(false);
  });

  it("sinCar vacía las características", () => {
    expect(sinCar({ ...base, caracteristicas: ["polos:2"] }).caracteristicas).toEqual([]);
  });
});
