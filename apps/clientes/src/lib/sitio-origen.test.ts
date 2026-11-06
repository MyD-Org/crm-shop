import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizarOrigenSitio, sitioOrigenDeEntorno, sitioParaMailDelPedido } from "./sitio-origen";

afterEach(() => vi.unstubAllEnvs());

describe("normalizarOrigenSitio", () => {
  it("deja sólo el origen https en minúsculas", () => {
    expect(normalizarOrigenSitio("https://Tienda-B.example/ruta?x=1#h")).toBe("https://tienda-b.example");
    expect(normalizarOrigenSitio("https://user:clave@cliente.example/")).toBe("https://cliente.example");
  });
  it("http sólo para localhost y 127.0.0.1", () => {
    expect(normalizarOrigenSitio("http://localhost:3000/x")).toBe("http://localhost:3000");
    expect(normalizarOrigenSitio("http://127.0.0.1:3001")).toBe("http://127.0.0.1:3001");
    expect(normalizarOrigenSitio("http://cliente.example")).toBeNull();
  });
  it("inválido o vacío es null", () => {
    for (const v of [null, undefined, "", "   ", "no es una url", "ftp://cliente.example", "javascript:alert(1)"]) {
      expect(normalizarOrigenSitio(v)).toBeNull();
    }
  });
});

describe("sitioOrigenDeEntorno", () => {
  it("lee NEXT_PUBLIC_SITE_URL normalizada", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://Cliente.example/");
    expect(sitioOrigenDeEntorno()).toBe("https://cliente.example");
  });
  it("sin la variable es null", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(sitioOrigenDeEntorno()).toBeNull();
  });
});

describe("sitioParaMailDelPedido", () => {
  it("usa el sitio guardado si es válido", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cliente.example");
    expect(sitioParaMailDelPedido("https://tienda-b.example")).toBe("https://tienda-b.example");
  });
  it("sin guardado o inválido cae al del entorno", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cliente.example");
    expect(sitioParaMailDelPedido(null)).toBe("https://cliente.example");
    expect(sitioParaMailDelPedido("basura")).toBe("https://cliente.example");
  });
  it("sin nada es undefined (los helpers de mail toman su default)", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(sitioParaMailDelPedido(null)).toBeUndefined();
  });
});
