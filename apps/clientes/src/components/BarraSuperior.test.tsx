import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BarraSuperior } from "./BarraSuperior";

const redPropia = [{ nombre: "Tienda B", usuario: "tienda_b" }];

describe("BarraSuperior", () => {
  it("un sitio propio muestra sólo su Instagram", () => {
    const html = renderToStaticMarkup(<BarraSuperior anuncio={undefined} visibilidad="siempre" redes={redPropia} whatsapp="" />);
    expect(html).toContain("https://www.instagram.com/tienda_b/");
    expect(html).not.toMatch(/central/i);
  });

  it("sin Instagram propio, sin anuncio y sin WhatsApp, la barra no existe", () => {
    expect(renderToStaticMarkup(<BarraSuperior anuncio={undefined} visibilidad="siempre" redes={[]} whatsapp="" />)).toBe("");
  });

  it("sin Instagram propio el elemento se oculta, pero el anuncio sigue", () => {
    const html = renderToStaticMarkup(<BarraSuperior anuncio="Envíos a todo el país" visibilidad="siempre" redes={[]} whatsapp="" />);
    expect(html).toContain("Envíos a todo el país");
    expect(html).not.toContain("instagram.com");
    expect(html).not.toContain("Seguinos");
  });

  it("el principal conserva redes, WhatsApp y anuncio como hoy", () => {
    const html = renderToStaticMarkup(
      <BarraSuperior
        anuncio="Hola"
        visibilidad="desktop"
        redes={[{ nombre: "Local", usuario: "cuenta_principal" }]}
        whatsapp="5491100000000"
      />,
    );
    expect(html).toContain("https://www.instagram.com/cuenta_principal/");
    expect(html).toContain("https://wa.me/5491100000000");
    expect(html).toContain("max-md:hidden");
  });
});
