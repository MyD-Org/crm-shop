import { describe, expect, it } from "vitest";
import { argumentosLogoConsola } from "./logo-consola";

describe("argumentosLogoConsola", () => {
  it("con logo: sólo la imagen, con el alto según la proporción del logo", () => {
    const args = argumentosLogoConsola({ logoUrl: "data:image/png;base64,AAA", nombre: "Tienda", proporcion: 4 });
    expect(args).toHaveLength(2);
    expect(args[0]).toBe("%c ");
    expect(args[1]).toContain('url("data:image/png;base64,AAA")');
    expect(args[1]).toContain("/ contain");
    expect(args[1]).toContain("padding: 30px 120px");
    expect(args[1]).not.toContain("Tienda");
  });

  it("sin logo: sólo el nombre", () => {
    expect(argumentosLogoConsola({ logoUrl: null, nombre: "Tienda" })[0]).toBe("%cTienda");
  });
});
