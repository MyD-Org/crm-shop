import { describe, expect, it } from "vitest";
import { decidirLocal, vinoDeLaCookie } from "./local-recordado";

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
      redirigirA: "categoria=paneles&retiro=mdp&recordado=1",
    });
    expect(d("/catalogo", "", "mdp")).toEqual({
      cookie: { accion: "ninguna" },
      redirigirA: "retiro=mdp&recordado=1",
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
      redirigirA: "q=&retiro=mdp&recordado=1",
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

describe("marcador recordado", () => {
  it("se conserva cuando coincide con la cookie (el catálogo ya redirigido no vuelve a redirigir)", () => {
    expect(d("/catalogo", "retiro=mdp&recordado=1", "mdp")).toEqual({ cookie: { accion: "ninguna" } });
  });

  it("se saca de un link compartido: sin cookie o con otro local", () => {
    expect(d("/catalogo", "retiro=mdp&recordado=1")).toEqual({
      cookie: { accion: "guardar", local: "mdp" },
      redirigirA: "retiro=mdp",
    });
    expect(d("/catalogo", "retiro=mdp&recordado=1", "igz")).toEqual({
      cookie: { accion: "guardar", local: "mdp" },
      redirigirA: "retiro=mdp",
    });
    expect(d("/catalogo", "recordado=1")).toEqual({ cookie: { accion: "ninguna" }, redirigirA: "" });
  });
});

describe("vinoDeLaCookie", () => {
  it("sí: el redirect del proxy marcó la URL y la cookie coincide con el local filtrado", () => {
    expect(vinoDeLaCookie({ recordado: "1", retiroEn: "mdp", cookie: "mdp" })).toBe(true);
    expect(vinoDeLaCookie({ recordado: "1", retiroEn: "mdp", cookie: "MDP" })).toBe(true);
  });

  it("no: sin marcador (el local lo eligió en esta visita o vino en un link)", () => {
    expect(vinoDeLaCookie({ recordado: undefined, retiroEn: "mdp", cookie: "mdp" })).toBe(false);
    expect(vinoDeLaCookie({ recordado: "0", retiroEn: "mdp", cookie: "mdp" })).toBe(false);
  });

  it("no: un link compartido con el marcador no avisa a quien no tiene esa cookie", () => {
    expect(vinoDeLaCookie({ recordado: "1", retiroEn: "mdp", cookie: undefined })).toBe(false);
    expect(vinoDeLaCookie({ recordado: "1", retiroEn: "mdp", cookie: "igz" })).toBe(false);
  });

  it("no: sin filtro de local vigente (desconocido o apagado)", () => {
    expect(vinoDeLaCookie({ recordado: "1", retiroEn: undefined, cookie: "mdp" })).toBe(false);
  });
});
