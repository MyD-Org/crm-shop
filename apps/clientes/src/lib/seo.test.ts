import { describe, expect, it } from "vitest";
import { baseDelSitio, entradasSitemap, reglasRobots } from "./seo";

describe("baseDelSitio", () => {
  it("devuelve el origin sin barra final", () => {
    expect(baseDelSitio("https://tienda.cliente.example/")).toBe("https://tienda.cliente.example");
  });

  it("es null sin variable o con una URL inválida", () => {
    expect(baseDelSitio(undefined)).toBeNull();
    expect(baseDelSitio("  ")).toBeNull();
    expect(baseDelSitio("no-es-url")).toBeNull();
  });
});

describe("reglasRobots", () => {
  it("apunta al sitemap absoluto y deja afuera las rutas del visitante", () => {
    const robots = reglasRobots("https://tienda.cliente.example");
    expect(robots.sitemap).toBe("https://tienda.cliente.example/sitemap.xml");
    expect(robots.rules).toMatchObject({ userAgent: "*", allow: "/" });
    const { disallow } = robots.rules as { disallow: string[] };
    expect(disallow).toEqual(expect.arrayContaining(["/api/", "/checkout", "/mi-cuenta", "/carrito"]));
    expect(disallow).not.toContain("/producto");
  });

  it("sin URL del sitio omite el sitemap (una ruta relativa no sirve)", () => {
    expect(reglasRobots(undefined)).not.toHaveProperty("sitemap");
  });
});

describe("entradasSitemap", () => {
  it("lista las páginas públicas y una ficha por producto, con URLs absolutas", () => {
    const urls = entradasSitemap("https://tienda.cliente.example", ["123", "a b"]).map((e) => e.url);
    expect(urls).toContain("https://tienda.cliente.example");
    expect(urls).toContain("https://tienda.cliente.example/catalogo");
    expect(urls).toContain("https://tienda.cliente.example/terminos");
    expect(urls).toContain("https://tienda.cliente.example/producto/123");
    expect(urls).toContain("https://tienda.cliente.example/producto/a%20b");
    expect(urls.some((u) => u.includes("/checkout") || u.includes("/mi-cuenta"))).toBe(false);
  });

  it("sin URL del sitio sale vacío", () => {
    expect(entradasSitemap(undefined, ["123"])).toEqual([]);
  });
});
