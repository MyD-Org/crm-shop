import { describe, expect, it } from "vitest";
import { MARCA_POR_DEFECTO, resolverMarca } from "./marca-base";

const ICONOS = {
  icon: [
    { url: "/favicon.ico", sizes: "48x48" },
    { url: "/icon.svg", type: "image/svg+xml" },
  ],
  apple: "/images/central-led/apple-icon.png",
};
import { metadataDeMarca } from "./metadata-marca";

/** Lo de Open Graph del sitio; la imagen la agrega src/app/opengraph-image.tsx. */
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

  it("declara sus íconos: el .ico de respaldo, src/app/icon.svg y el de iOS", () => {
    expect(metadataDeMarca(MARCA_POR_DEFECTO, {}).icons).toEqual(ICONOS);
  });

  it("otra marca sobre la base de Central no hereda sus íconos", () => {
    expect(metadataDeMarca(resolverMarca({ nombre: "Otra Tienda" }), {})).not.toHaveProperty("icons");
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
    expect(meta).not.toHaveProperty("icons");
  });

  it("con favicon propio lo declara", () => {
    const m = resolverMarca({ base: "generica", nombre: "T", faviconUrl: "https://media.example/f.png" }, undefined, [
      "media.example",
    ]);
    expect(metadataDeMarca(m, {}).icons).toEqual({ icon: "https://media.example/f.png" });
  });
});
