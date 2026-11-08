import { describe, expect, it } from "vitest";
import { argumentosLogoConsola } from "./logo-consola";

describe("argumentosLogoConsola", () => {
  it("con logo: imagen de fondo absoluta y el nombre como texto", () => {
    const [fmt, imagen, texto] = argumentosLogoConsola({ logoUrl: "https://cliente.example/logo.svg", nombre: "Tienda" });
    expect(fmt).toBe("%c %c\nTienda");
    expect(imagen).toContain('url("https://cliente.example/logo.svg")');
    expect(imagen).toContain("padding: 24px 120px");
    expect(texto).toContain("font:");
  });

  it("sin logo: sólo el nombre", () => {
    expect(argumentosLogoConsola({ logoUrl: null, nombre: "Tienda" })).toHaveLength(2);
  });
});
