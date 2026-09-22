import { describe, expect, it } from "vitest";
import { fotosPermitidas, hostsDeMedios } from "./catalogo-medios";

const f1 = { url: "https://media.plataforma.example/a.jpg", w: 800, alt: "Lámpara" };
const f2 = { url: "https://otro.example/b.jpg", w: 600 };

describe("hostsDeMedios", () => {
  it("parte por coma, recorta espacios y descarta vacíos", () => {
    expect(hostsDeMedios("media.plataforma.example, cdn.plataforma.example ,")).toEqual([
      "media.plataforma.example",
      "cdn.plataforma.example",
    ]);
  });

  it("sin valor no hay hosts", () => {
    expect(hostsDeMedios(undefined)).toEqual([]);
    expect(hostsDeMedios("")).toEqual([]);
    expect(hostsDeMedios(" , ")).toEqual([]);
  });
});

describe("fotosPermitidas", () => {
  it("se queda sólo con las fotos de hosts configurados", () => {
    expect(fotosPermitidas([f1, f2], ["media.plataforma.example"])).toEqual([f1]);
  });

  it("sin hosts configurados no hay fotos (la card muestra el placeholder)", () => {
    expect(fotosPermitidas([f1, f2], [])).toBeUndefined();
  });

  it("sin fotos devuelve undefined", () => {
    expect(fotosPermitidas(null, ["media.plataforma.example"])).toBeUndefined();
    expect(fotosPermitidas(undefined, ["media.plataforma.example"])).toBeUndefined();
    expect(fotosPermitidas([], ["media.plataforma.example"])).toBeUndefined();
  });

  it("si ninguna foto pasa el filtro devuelve undefined", () => {
    expect(fotosPermitidas([f2], ["media.plataforma.example"])).toBeUndefined();
  });

  it("descarta URLs no parseables y las que no son https", () => {
    const rota = { url: "no es una url", w: 100 };
    const http = { url: "http://media.plataforma.example/c.jpg", w: 100 };
    expect(fotosPermitidas([rota, http, f1], ["media.plataforma.example"])).toEqual([f1]);
  });

  it("copia sólo url, w y alt", () => {
    const conExtra = { ...f1, extra: "x" } as typeof f1;
    expect(fotosPermitidas([conExtra], ["media.plataforma.example"])).toEqual([
      { url: f1.url, w: 800, alt: "Lámpara" },
    ]);
  });
});
