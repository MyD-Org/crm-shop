import { describe, expect, it } from "vitest";
import { resolverTema } from "./tema-ip";

describe("resolverTema con geo-IP activa", () => {
  it("sin nada → calido (default del sitio)", () => {
    expect(resolverTema({ consulta: null, cookie: null, pais: null, region: null, geoActiva: true })).toBe("calido");
  });

  it("Misiones (AR + región N) → calido-azul", () => {
    expect(resolverTema({ consulta: null, cookie: null, pais: "AR", region: "N", geoActiva: true })).toBe("calido-azul");
  });

  it("resto de Argentina y otros países → calido", () => {
    expect(resolverTema({ consulta: null, cookie: null, pais: "AR", region: "B", geoActiva: true })).toBe("calido");
    expect(resolverTema({ consulta: null, cookie: null, pais: "BR", region: "N", geoActiva: true })).toBe("calido");
  });

  it("la cookie guardada pisa a la geo", () => {
    expect(resolverTema({ consulta: null, cookie: "calido", pais: "AR", region: "N", geoActiva: true })).toBe("calido");
    expect(resolverTema({ consulta: null, cookie: "calido-azul", pais: "AR", region: "C", geoActiva: true })).toBe("calido-azul");
  });

  it("cookie inválida → cae a geo", () => {
    expect(resolverTema({ consulta: null, cookie: "basura", pais: "AR", region: "N", geoActiva: true })).toBe("calido-azul");
  });

  it("?tema= pisa a todo y persiste (azul/calido)", () => {
    expect(resolverTema({ consulta: "azul", cookie: "calido", pais: null, region: null, geoActiva: true })).toBe("calido-azul");
    expect(resolverTema({ consulta: "calido", cookie: "calido-azul", pais: "AR", region: "N", geoActiva: true })).toBe("calido");
  });

  it("?tema=auto borra la preferencia (vuelve a geo)", () => {
    expect(resolverTema({ consulta: "auto", cookie: "calido-azul", pais: null, region: null, geoActiva: true })).toBe("auto");
  });
});

describe("resolverTema con geo-IP apagada (hoy)", () => {
  it("todos → calido-azul, sin importar geo ni cookie", () => {
    expect(resolverTema({ consulta: null, cookie: null, pais: null, region: null })).toBe("calido-azul");
    expect(resolverTema({ consulta: null, cookie: "calido", pais: "AR", region: "B" })).toBe("calido-azul");
  });

  it("?tema= sigue mandando en el request que lo trae", () => {
    expect(resolverTema({ consulta: "calido", cookie: null, pais: null, region: null })).toBe("calido");
    expect(resolverTema({ consulta: "auto", cookie: "calido", pais: null, region: null })).toBe("auto");
  });
});
