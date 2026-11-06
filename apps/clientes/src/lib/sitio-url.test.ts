import { afterEach, describe, expect, it, vi } from "vitest";
import { esSitioSecundario, urlCanonicaBase, urlCanonicaDelSitio } from "./sitio-url";

const SITE = "https://cliente.example";
const CANON = "https://tienda-b.example";

describe("urlCanonicaBase", () => {
  it("sin CANONICAL es el origin de SITE", () => {
    expect(urlCanonicaBase(undefined, `${SITE}/`)).toBe(SITE);
  });

  it("una CANONICAL válida gana sobre SITE", () => {
    expect(urlCanonicaBase(`${CANON}/algo`, SITE)).toBe(CANON);
  });

  it("CANONICAL vacía, con espacios, inválida o no https cae a SITE sin tirar", () => {
    for (const malo of ["", "   ", "no-es-url", "http://tienda-b.example", "ftp://tienda-b.example"]) {
      expect(urlCanonicaBase(malo, SITE)).toBe(SITE);
    }
  });

  it("http solo se admite en localhost", () => {
    expect(urlCanonicaBase("http://localhost:3000", SITE)).toBe("http://localhost:3000");
  });

  it("sin ninguna de las dos es undefined", () => {
    expect(urlCanonicaBase(undefined, undefined)).toBeUndefined();
    expect(urlCanonicaBase("  ", "")).toBeUndefined();
  });
});

describe("esSitioSecundario", () => {
  it("origins distintos: true", () => {
    expect(esSitioSecundario(CANON, SITE)).toBe(true);
  });

  it("igual origin o CANONICAL ausente/inválida: false", () => {
    expect(esSitioSecundario(`${SITE}/`, SITE)).toBe(false);
    expect(esSitioSecundario(undefined, SITE)).toBe(false);
    expect(esSitioSecundario("  ", SITE)).toBe(false);
    expect(esSitioSecundario("http://tienda-b.example", SITE)).toBe(false);
  });

  it("sin SITE no hay secundario", () => {
    expect(esSitioSecundario(CANON, undefined)).toBe(false);
  });
});

describe("urlCanonicaDelSitio", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lee las dos variables de entorno", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    vi.stubEnv("NEXT_PUBLIC_CANONICAL_URL", CANON);
    expect(urlCanonicaDelSitio()).toBe(CANON);
  });

  it("sin CANONICAL, SITE", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    vi.stubEnv("NEXT_PUBLIC_CANONICAL_URL", "");
    expect(urlCanonicaDelSitio()).toBe(SITE);
  });
});
