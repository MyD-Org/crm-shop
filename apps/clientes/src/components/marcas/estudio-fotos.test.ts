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

  it("globals.css tiene los dos estudios con fondo y sombra, sin reflejo (Emanuel: \"solo sombra\")", () => {
    const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
    expect(css).toMatch(/\[data-estudio="oscuro"\][^{]*\{[^}]*#2c2c32/);
    expect(css).toMatch(/\[data-estudio="claro"\][^{]*\{[^}]*#f6f5f2/);
    expect(css).not.toMatch(/box-reflect/);
  });

  it("el CSS no depende de data-layout (las cards del carrusel no lo llevan): usa data-card-producto", () => {
    const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
    const reglas = css.slice(css.indexOf("[data-estudio]"));
    expect(reglas).not.toMatch(/\[data-layout\]/);
    expect(reglas).toMatch(/\[data-estudio\] \[data-card-producto\] > div:first-child/);
    const tarjeta = readFileSync(join(__dirname, "..", "TarjetaProductoCarrusel.tsx"), "utf8");
    expect(tarjeta).toMatch(/data-card-producto=""/);
  });

  it("Los más elegidos y el bloque de la home aplican el atributo", () => {
    const bloque = readFileSync(join(__dirname, "bloques", "ProductosMarca.tsx"), "utf8");
    const home = readFileSync(join(__dirname, "..", "home", "TiendaOficialHome.tsx"), "utf8");
    expect(bloque).toMatch(/atributoEstudio\(elegidos\.estiloFotos\)/);
    expect(home).toMatch(/atributoEstudio\(/);
  });
});
