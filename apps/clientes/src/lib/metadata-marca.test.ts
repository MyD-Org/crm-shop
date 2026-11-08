import { describe, expect, it } from "vitest";
import { MARCA_POR_DEFECTO, resolverMarca } from "./marca-base";

const ICONOS = {
  icon: [
    { url: "/images/central-led/favicon.ico", sizes: "48x48" },
    { url: "/images/central-led/icon.svg", type: "image/svg+xml" },
  ],
  apple: "/images/central-led/apple-icon.png",
};
import { destinoFavicon, IMAGEN_SITIO_ALT, metadataDeMarca, urlImagenDelSitio } from "./metadata-marca";

/** Lo de Open Graph del sitio; la imagen (con el origen propio) sólo si se pasa `propioUrl`. */
const OG_CENTRAL = { type: "website", siteName: "Central LED", locale: "es_AR" };

/**
 * Caracterización de Central Led: con la marca vacía el `metadata` del layout es EXACTAMENTE el
 * objeto que estaba escrito en `src/app/layout.tsx` antes de que la marca saliera de la base, más
 * los íconos del logo nuevo.
 */
describe("metadataDeMarca — Central sin cambios", () => {
  it("sin dominio ni verificación", () => {
    expect(metadataDeMarca(MARCA_POR_DEFECTO, {})).toEqual({
      metadataBase: undefined,
      title: "Central LED — Tienda Online",
      description:
        "Iluminación, materiales eléctricos, herramientas y mucho más en Puerto Iguazú, Misiones. Stock en tiempo real.",
      icons: ICONOS,
      openGraph: OG_CENTRAL,
    });
  });

  it("con dominio y verificación de Meta", () => {
    expect(
      metadataDeMarca(MARCA_POR_DEFECTO, { siteUrl: "https://tienda.example", facebookToken: "abc123" }),
    ).toEqual({
      metadataBase: new URL("https://tienda.example"),
      title: "Central LED — Tienda Online",
      description:
        "Iluminación, materiales eléctricos, herramientas y mucho más en Puerto Iguazú, Misiones. Stock en tiempo real.",
      icons: ICONOS,
      openGraph: OG_CENTRAL,
      verification: { other: { "facebook-domain-verification": "abc123" } },
    });
  });

  it("con verificación de Google (Search Console) emite su meta; con las dos, ambas", () => {
    expect(metadataDeMarca(MARCA_POR_DEFECTO, { googleToken: "g-tok_1" }).verification).toEqual({ google: "g-tok_1" })
    expect(
      metadataDeMarca(MARCA_POR_DEFECTO, { googleToken: "g-tok_1", facebookToken: "abc123" }).verification,
    ).toEqual({ google: "g-tok_1", other: { "facebook-domain-verification": "abc123" } })
  });

  it("un token de Google vacío o con espacios no emite nada", () => {
    expect(metadataDeMarca(MARCA_POR_DEFECTO, { googleToken: "  " })).not.toHaveProperty("verification")
  });

  it("declara sus íconos: el .ico de respaldo, el SVG y el de iOS (todos en public/images/central-led/)", () => {
    expect(metadataDeMarca(MARCA_POR_DEFECTO, {}).icons).toEqual(ICONOS);
  });

  it("otra marca sobre la base de Central no hereda sus íconos: declara el neutro", () => {
    const icons = metadataDeMarca(resolverMarca({ nombre: "Otra Tienda" }), {}).icons;
    expect(icons).toEqual({ icon: [{ url: "/images/generica/icon.svg", type: "image/svg+xml" }] });
    expect(JSON.stringify(icons)).not.toMatch(/central/i);
  });

  it("la marca vacía resuelta de la base da lo mismo que la constante", () => {
    expect(metadataDeMarca(resolverMarca({}), {})).toEqual(metadataDeMarca(MARCA_POR_DEFECTO, {}));
  });
});

describe("metadataDeMarca — tienda con marca propia", () => {
  it("título y descripción propios, sin rastro de Central", () => {
    const m = resolverMarca({ base: "generica", nombre: "Tienda Uno" });
    const meta = metadataDeMarca(m, {});
    expect(meta.title).toBe("Tienda Uno — Tienda Online");
    expect(JSON.stringify(meta)).not.toMatch(/central|iguaz/i);
    expect(meta.icons).toEqual({ icon: [{ url: "/images/generica/icon.svg", type: "image/svg+xml" }] });
  });

  it("con favicon propio lo declara", () => {
    const m = resolverMarca({ base: "generica", nombre: "T", faviconUrl: "https://media.example/f.png" }, undefined, [
      "media.example",
    ]);
    expect(metadataDeMarca(m, {}).icons).toEqual({ icon: "https://media.example/f.png" });
  });
});

describe("destinoFavicon (/favicon.ico)", () => {
  it("Central: su .ico", () => {
    expect(destinoFavicon(MARCA_POR_DEFECTO)).toBe("/images/central-led/favicon.ico");
  });

  it("con favicon propio: ese", () => {
    const m = resolverMarca({ base: "generica", nombre: "T", faviconUrl: "https://media.example/f.png" }, undefined, ["media.example"]);
    expect(destinoFavicon(m)).toBe("https://media.example/f.png");
  });

  it("otra marca sin favicon: el neutro, nunca el de Central", () => {
    expect(destinoFavicon(resolverMarca({ base: "generica", nombre: "T" }))).toBe("/images/generica/icon.svg");
    expect(destinoFavicon(resolverMarca({ nombre: "Otra Tienda" }))).toBe("/images/generica/icon.svg");
  });
});

describe("imagen de vista previa (og:image)", () => {
  it("con CANONICAL en otro origen, la imagen usa el origen PROPIO y metadataBase queda canónico", () => {
    const meta = metadataDeMarca(MARCA_POR_DEFECTO, {
      siteUrl: "https://principal.example",
      propioUrl: "https://secundario.example",
    });
    expect(meta.metadataBase).toEqual(new URL("https://principal.example"));
    expect(meta.openGraph).toMatchObject({
      images: [
        { url: "https://secundario.example/imagen-para-compartir", width: 1200, height: 630, alt: IMAGEN_SITIO_ALT },
      ],
    });
    expect(JSON.stringify(meta.openGraph)).not.toContain("principal.example");
  });

  it("el alt no nombra a ninguna marca", () => {
    expect(IMAGEN_SITIO_ALT).not.toMatch(/central/i);
  });

  it("sin origen propio válido no manda imagen", () => {
    expect(urlImagenDelSitio(undefined)).toBeUndefined();
    expect(urlImagenDelSitio("no es una url")).toBeUndefined();
    expect(metadataDeMarca(MARCA_POR_DEFECTO, { siteUrl: "https://principal.example" }).openGraph).not.toHaveProperty("images");
  });
});
