import { describe, expect, it } from "vitest";
import { jsonLdSitio, jsonLdSitioHtml } from "./sitio-jsonld";

describe("jsonLdSitio", () => {
  it("sin NEXT_PUBLIC_SITE_URL no emite nada", () => {
    expect(jsonLdSitio(undefined)).toBeUndefined();
    expect(jsonLdSitioHtml(undefined)).toBeUndefined();
  });

  it("con base arma Organization + WebSite (sin doble barra)", () => {
    const jsonLd = jsonLdSitio("https://tienda.example/");
    expect(jsonLd?.["@graph"]).toEqual([
      { "@type": "Organization", name: "Central LED — Tienda Online", url: "https://tienda.example" },
      { "@type": "WebSite", name: "Central LED — Tienda Online", url: "https://tienda.example" },
    ]);
  });
});

describe("jsonLdSitioHtml", () => {
  it("es JSON válido y escapa </script>", () => {
    const html = jsonLdSitioHtml("https://tienda.example");
    expect(html).toBeDefined();
    expect(() => JSON.parse(html as string)).not.toThrow();
    expect(html).not.toContain("</script>");
  });
});
