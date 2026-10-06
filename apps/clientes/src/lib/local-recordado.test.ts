import { describe, expect, it } from "vitest";
import { decidirLocal } from "./local-recordado";

const d = (pathname: string, qs: string, cookie?: string) =>
  decidirLocal({ pathname, search: new URLSearchParams(qs), cookie });

describe("decidirLocal", () => {
  it("el enlace a la home guarda el local sin redirigir", () => {
    expect(d("/", "sucursal=mdp")).toEqual({ cookie: { accion: "guardar", local: "mdp" } });
    expect(d("/", "retiro=mdp")).toEqual({ cookie: { accion: "guardar", local: "mdp" } });
  });

  it("en el catálogo, sucursal se traduce a retiro", () => {
    expect(d("/catalogo", "q=led&sucursal=mdp")).toEqual({
      cookie: { accion: "guardar", local: "mdp" },
      redirigirA: "q=led&retiro=mdp",
    });
  });

  it("sucursal=todos en la home borra la cookie", () => {
    expect(d("/", "sucursal=todos", "mdp")).toEqual({ cookie: { accion: "borrar" } });
  });

  it("normaliza mayúsculas y no reescribe la cookie si es la misma", () => {
    expect(d("/", "retiro=MDP", "mdp")).toEqual({ cookie: { accion: "ninguna" } });
  });

  it("elegir otro local en el catálogo lo recuerda", () => {
    expect(d("/catalogo", "retiro=igz", "mdp")).toEqual({
      cookie: { accion: "guardar", local: "igz" },
    });
  });

  it("entrar al catálogo sin retiro con local recordado redirige agregándolo", () => {
    expect(d("/catalogo", "categoria=paneles", "mdp")).toEqual({
      cookie: { accion: "ninguna" },
      redirigirA: "categoria=paneles&retiro=mdp",
    });
    expect(d("/catalogo", "", "mdp")).toEqual({
      cookie: { accion: "ninguna" },
      redirigirA: "retiro=mdp",
    });
  });

  it("una búsqueda (con q) arranca limpia: no recibe el local recordado y la cookie se conserva", () => {
    expect(d("/catalogo", "q=led&ia=1", "mdp")).toEqual({ cookie: { accion: "ninguna" } });
    expect(d("/catalogo", "q=led&stock=todos", "mdp")).toEqual({ cookie: { accion: "ninguna" } });
    expect(d("/catalogo", "categoria=paneles&q=led", "mdp")).toEqual({ cookie: { accion: "ninguna" } });
  });

  it("una búsqueda con retiro o sucursal explícito sigue aplicándolo", () => {
    expect(d("/catalogo", "q=led&retiro=igz", "mdp")).toEqual({
      cookie: { accion: "guardar", local: "igz" },
    });
    expect(d("/catalogo", "q=led&sucursal=igz", "mdp")).toEqual({
      cookie: { accion: "guardar", local: "igz" },
      redirigirA: "q=led&retiro=igz",
    });
  });

  it("una q vacía no cuenta como búsqueda", () => {
    expect(d("/catalogo", "q=", "mdp")).toEqual({
      cookie: { accion: "ninguna" },
      redirigirA: "q=&retiro=mdp",
    });
  });

  it("fuera del catálogo no redirige", () => {
    expect(d("/producto/1", "", "mdp")).toEqual({ cookie: { accion: "ninguna" } });
  });

  it("sin cookie no hace nada", () => {
    expect(d("/catalogo", "q=led")).toEqual({ cookie: { accion: "ninguna" } });
  });

  it("retiro=todos borra la cookie y en el catálogo limpia la URL", () => {
    expect(d("/catalogo", "q=led&retiro=todos", "mdp")).toEqual({
      cookie: { accion: "borrar" },
      redirigirA: "q=led",
    });
    expect(d("/", "retiro=todos", "mdp")).toEqual({ cookie: { accion: "borrar" } });
  });

  it("un valor inválido no se guarda", () => {
    expect(d("/", "retiro=<script>")).toEqual({ cookie: { accion: "ninguna" } });
  });

  it("una cookie inválida no redirige", () => {
    expect(d("/catalogo", "", "../x")).toEqual({ cookie: { accion: "ninguna" } });
  });
});
