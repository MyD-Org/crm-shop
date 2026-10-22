import { describe, expect, it } from "vitest";
import { MARCA_POR_DEFECTO, resolverMarca } from "./marca-base";
import { manifestDeMarca } from "./manifest-marca";

describe("manifestDeMarca — Central sin cambios", () => {
  it("es el manifest de siempre", () => {
    expect(manifestDeMarca(MARCA_POR_DEFECTO)).toEqual({
      name: "Central LED — Tienda Online",
      short_name: "Central LED",
      description:
        "Iluminación, materiales eléctricos, herramientas y mucho más en Puerto Iguazú, Misiones.",
      lang: "es-AR",
      start_url: "/",
      display: "browser",
      background_color: "#f8f8f6",
      theme_color: "#16283f",
      icons: [
        { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
        { src: "/images/central-led/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/images/central-led/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/images/central-led/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    });
  });
});

describe("manifestDeMarca — marca propia", () => {
  it("nombre y descripción propios; sin rastro de Central", () => {
    const m = manifestDeMarca(resolverMarca({ base: "generica", nombre: "Tienda Uno" }));
    expect(m.name).toBe("Tienda Uno — Tienda Online");
    expect(m.short_name).toBe("Tienda Uno");
    expect(JSON.stringify(m)).not.toMatch(/central|iguaz/i);
    expect(m.icons).toEqual([{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]);
  });

  it("con ícono propio lo usa", () => {
    const marca = resolverMarca({ base: "generica", nombre: "T", faviconUrl: "https://media.example/f.png" }, undefined, [
      "media.example",
    ]);
    expect(manifestDeMarca(marca).icons).toEqual([
      { src: "https://media.example/f.png", sizes: "any", type: "image/png" },
    ]);
  });

  it("con paleta propia del tenant: fondo y tema salen de ella; el resto igual", () => {
    const m = manifestDeMarca(MARCA_POR_DEFECTO, {
      fondo: "#faf6ef",
      tema: "#241c14",
      tinta: "#2a2118",
      suave: "#70665a",
      acento: "#a8562a",
    });
    expect(m.background_color).toBe("#faf6ef");
    expect(m.theme_color).toBe("#241c14");
    expect(m.name).toBe("Central LED — Tienda Online");
  });
});
