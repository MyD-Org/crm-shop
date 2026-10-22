import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claseFusionLogo } from "./logo-marca";

/**
 * El logo de una marca se muestra tal cual, sin caja blanca alrededor (un logo con su propio fondo
 * negro quedaba como un cuadradito dentro de un marco blanco). Para que el fondo del archivo no se
 * note, se funde con el de la página: en tema oscuro `screen` (el negro desaparece), en claro
 * `multiply` (el blanco desaparece).
 */
describe("logo de la marca", () => {
  it("la fusión depende de si el fondo es oscuro o claro", () => {
    expect(claseFusionLogo(true)).toBe("mix-blend-screen");
    expect(claseFusionLogo(false)).toBe("mix-blend-multiply");
  });

  it("ni el encabezado ni el bloque de la home lo meten en una caja blanca", () => {
    const bloques = readFileSync(join(__dirname, "bloques", "BloquesMarca.tsx"), "utf8");
    const home = readFileSync(join(__dirname, "..", "home", "TiendaOficialHome.tsx"), "utf8");
    for (const src of [bloques, home]) {
      expect(src).toMatch(/<LogoMarca\b/);
      expect(src).not.toMatch(/bg-white/);
    }
  });
});
