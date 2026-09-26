import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("manifest", () => {
  it("nombre, idioma y arranque", () => {
    const m = manifest();
    expect(m.name).toBe("Central LED — Tienda Online");
    expect(m.short_name).toBe("Central LED");
    expect(m.lang).toBe("es-AR");
    expect(m.start_url).toBe("/");
  });

  it("colores coherentes con el tema calido-azul (default) de globals.css", () => {
    const m = manifest();
    expect(m.background_color).toBe("#f8f8f6");
    expect(m.theme_color).toBe("#16283f");
  });

  it("sólo íconos que existen de verdad (src/app/icon.svg, servido en /icon.svg)", () => {
    const m = manifest();
    expect(m.icons).toEqual([{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]);
  });
});
