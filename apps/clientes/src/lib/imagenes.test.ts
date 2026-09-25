import { describe, expect, it } from "vitest";
import { esImagenOptimizable } from "./imagenes";

const hosts = ["media.plataforma.example"];

describe("esImagenOptimizable", () => {
  it("acepta rutas locales", () => {
    expect(esImagenOptimizable("/images/hero.webp", hosts)).toBe(true);
    expect(esImagenOptimizable("/images/hero.webp", [])).toBe(true);
  });

  it("acepta https de un host permitido", () => {
    expect(esImagenOptimizable("https://media.plataforma.example/home/a.webp", hosts)).toBe(true);
  });

  it("rechaza un host ajeno o sin hosts configurados", () => {
    expect(esImagenOptimizable("https://otro.example/a.webp", hosts)).toBe(false);
    expect(esImagenOptimizable("https://media.plataforma.example/a.webp", [])).toBe(false);
  });

  it("rechaza http, data:, protocolo relativo y URLs inválidas", () => {
    expect(esImagenOptimizable("http://media.plataforma.example/a.webp", hosts)).toBe(false);
    expect(esImagenOptimizable("data:image/gif;base64,R0lGODlhAQABAAAAACw=", hosts)).toBe(false);
    expect(esImagenOptimizable("//media.plataforma.example/a.webp", hosts)).toBe(false);
    expect(esImagenOptimizable("no es una url", hosts)).toBe(false);
    expect(esImagenOptimizable("", hosts)).toBe(false);
  });
});
