import { describe, expect, it } from "vitest";
import { redireccionSucursal } from "./enlace-sucursal";

const r = (pathname: string, qs: string) => redireccionSucursal(pathname, new URLSearchParams(qs));

describe("redireccionSucursal", () => {
  it("en el catálogo, sucursal se traduce a retiro", () => {
    expect(r("/catalogo", "sucursal=mdp")).toBe("retiro=mdp");
    expect(r("/catalogo", "q=led&sucursal=MDP")).toBe("q=led&retiro=mdp");
  });

  it("sucursal=todos llega sin filtro de local", () => {
    expect(r("/catalogo", "sucursal=todos&retiro=mdp&categoria=HOGAR")).toBe("categoria=HOGAR");
  });

  it("saca el marcador recordado de los links viejos", () => {
    expect(r("/catalogo", "categoria=HOGAR&retiro=mdp&recordado=1")).toBe("categoria=HOGAR&retiro=mdp");
  });

  it("un slug inválido se descarta", () => {
    expect(r("/catalogo", "sucursal=../x")).toBe("");
  });

  it("sin sucursal ni recordado no redirige: no hay nada recordado que agregar", () => {
    expect(r("/catalogo", "")).toBeUndefined();
    expect(r("/catalogo", "categoria=HOGAR")).toBeUndefined();
    expect(r("/catalogo", "retiro=mdp")).toBeUndefined();
  });

  it("fuera del catálogo no hace nada", () => {
    expect(r("/", "sucursal=mdp")).toBeUndefined();
    expect(r("/producto/1", "sucursal=mdp")).toBeUndefined();
  });
});
