import { describe, expect, it } from "vitest";
import { claveSitio, resolverSitio, resolverSitioPorClave } from "./sitio";

const MARCA_B = { base: "generica", nombre: "Tienda B" };
const EXTRAS = [
  { etiqueta: "alias", url: "https://alias.cliente.example" },
  {
    etiqueta: "tienda-b",
    url: "https://tienda-b.example",
    marca: MARCA_B,
    tema: { base: "calido" },
    remitente: "pedidos@tienda-b.example",
  },
];

describe("resolverSitio", () => {
  it("el sitio del extra con marca propia: etiqueta, marca, tema y remitente", () => {
    const s = resolverSitio("https://tienda-b.example", EXTRAS);
    expect(s).toEqual({
      etiqueta: "tienda-b",
      propio: true,
      marca: MARCA_B,
      tema: { base: "calido" },
      remitente: "pedidos@tienda-b.example",
    });
  });

  it("normaliza barra final, mayúsculas y camino", () => {
    expect(resolverSitio("HTTPS://Tienda-B.example/", EXTRAS).propio).toBe(true);
    expect(resolverSitio("https://tienda-b.example/algo", EXTRAS).propio).toBe(true);
  });

  it("un extra sin marca es un alias: hereda el principal", () => {
    expect(resolverSitio("https://alias.cliente.example", EXTRAS)).toEqual({ etiqueta: null, propio: false });
  });

  it("un extra con marca vacía o no objeto también es alias", () => {
    for (const marca of [{}, null, "x", []]) {
      const s = resolverSitio("https://z.example", [{ etiqueta: "z", url: "https://z.example", marca }]);
      expect(s.propio).toBe(false);
    }
  });

  it("sin coincidencia, sin URL o con extras ilegibles: el principal", () => {
    const principal = { etiqueta: null, propio: false };
    expect(resolverSitio("https://cliente.example", EXTRAS)).toEqual(principal);
    expect(resolverSitio(undefined, EXTRAS)).toEqual(principal);
    expect(resolverSitio("no es una url", EXTRAS)).toEqual(principal);
    for (const crudo of [null, undefined, "x", 3, {}, [null, 4, "a", { url: 1 }]]) {
      expect(resolverSitio("https://tienda-b.example", crudo)).toEqual(principal);
    }
  });

  it("el override por etiqueta gana sobre la URL", () => {
    expect(resolverSitio("https://preview-123.vercel.example", EXTRAS, "tienda-b").etiqueta).toBe("tienda-b");
    expect(resolverSitio("https://tienda-b.example", EXTRAS, "alias").propio).toBe(false);
    expect(resolverSitio("https://tienda-b.example", EXTRAS, "no-existe").propio).toBe(true);
  });

  it("un remitente que no es un email se descarta", () => {
    const s = resolverSitio("https://tienda-b.example", [
      { etiqueta: "tienda-b", url: "https://tienda-b.example", marca: MARCA_B, remitente: "no-es-mail" },
    ]);
    expect(s.remitente).toBeUndefined();
  });
});

describe("clave del sitio", () => {
  it("sale del entorno, nunca de un header, y distingue sitios", () => {
    const a = claveSitio({ NEXT_PUBLIC_SITE_URL: "https://tienda-b.example/" });
    const b = claveSitio({ NEXT_PUBLIC_SITE_URL: "https://cliente.example" });
    expect(a).not.toBe(b);
    expect(claveSitio({})).toBe("|");
  });

  it("SHOP_SITIO sólo vale fuera de producción", () => {
    const base = { NEXT_PUBLIC_SITE_URL: "https://x.example", SHOP_SITIO: "tienda-b" };
    expect(claveSitio({ ...base, VERCEL_ENV: "preview" })).toContain("tienda-b");
    expect(claveSitio({ ...base, VERCEL_ENV: "production" })).not.toContain("tienda-b");
  });

  it("resolverSitioPorClave resuelve igual que resolverSitio", () => {
    const clave = claveSitio({ NEXT_PUBLIC_SITE_URL: "https://tienda-b.example" });
    expect(resolverSitioPorClave(clave, EXTRAS)).toEqual(resolverSitio("https://tienda-b.example", EXTRAS));
    const conOverride = claveSitio({ NEXT_PUBLIC_SITE_URL: "https://preview.example", SHOP_SITIO: "tienda-b", VERCEL_ENV: "preview" });
    expect(resolverSitioPorClave(conOverride, EXTRAS).propio).toBe(true);
  });
});
