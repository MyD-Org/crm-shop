import { describe, expect, it } from "vitest";
import { MARCA_POR_DEFECTO } from "./marca-base";
import { jsonLdSitio, jsonLdSitioHtml } from "./sitio-jsonld";

const NOMBRE = MARCA_POR_DEFECTO.titulo;

describe("jsonLdSitio", () => {
  it("sin NEXT_PUBLIC_SITE_URL no emite nada", () => {
    expect(jsonLdSitio(undefined, NOMBRE)).toBeUndefined();
    expect(jsonLdSitioHtml(undefined, NOMBRE)).toBeUndefined();
  });

  it("con base arma Organization + WebSite (sin doble barra)", () => {
    const jsonLd = jsonLdSitio("https://tienda.example/", NOMBRE);
    expect(jsonLd?.["@graph"]).toEqual([
      { "@type": "Organization", name: "Central LED — Tienda Online", url: "https://tienda.example" },
      { "@type": "WebSite", name: "Central LED — Tienda Online", url: "https://tienda.example" },
    ]);
  });
});

describe("jsonLdSitioHtml", () => {
  it("es JSON válido y escapa </script>", () => {
    const html = jsonLdSitioHtml("https://tienda.example", NOMBRE);
    expect(html).toBeDefined();
    expect(() => JSON.parse(html as string)).not.toThrow();
    expect(html).not.toContain("</script>");
  });

  it("con otra marca usa su nombre y no el de Central", () => {
    const html = jsonLdSitioHtml("https://tienda.example", "Tienda Uno — Tienda Online");
    expect(html).toContain("Tienda Uno — Tienda Online");
    expect(html).not.toMatch(/central/i);
  });
});
