import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atributoEstudio } from "./estudio-fotos";

/**
 * Estilo "estudio" de las fotos de producto (bloque Los más elegidos y el bloque Tienda oficial
 * de la home): fondo, sombra de contacto y reflejo los dibuja el CSS de la card sobre la foto sin
 * fondo (PNG con alfa, recortada al contenido). Se activa con `data-estudio` en un contenedor.
 */
describe("estilo estudio de las cards", () => {
  it("el atributo sale del estilo elegido; normal no pone nada", () => {
    expect(atributoEstudio(undefined)).toEqual({});
    expect(atributoEstudio("estudio-oscuro")).toEqual({ "data-estudio": "oscuro" });
    expect(atributoEstudio("estudio-claro")).toEqual({ "data-estudio": "claro" });
  });

  it("globals.css tiene los dos estudios con fondo y sombra, y el reflejo sólo en el oscuro", () => {
    const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
    expect(css).toMatch(/\[data-estudio="oscuro"\][^{]*\{[^}]*#2c2c32/);
    expect(css).toMatch(/\[data-estudio="claro"\][^{]*\{[^}]*#f6f5f2/);
    expect(css).toMatch(/\[data-estudio="oscuro"\][^{]*img\s*\{[^}]*box-reflect/);
    expect(css).not.toMatch(/\[data-estudio="claro"\][^{]*img\s*\{[^}]*box-reflect/);
  });

  it("Los más elegidos y el bloque de la home aplican el atributo", () => {
    const bloque = readFileSync(join(__dirname, "bloques", "ProductosMarca.tsx"), "utf8");
    const home = readFileSync(join(__dirname, "..", "home", "TiendaOficialHome.tsx"), "utf8");
    expect(bloque).toMatch(/atributoEstudio\(elegidos\.estiloFotos\)/);
    expect(home).toMatch(/atributoEstudio\(/);
  });
});
