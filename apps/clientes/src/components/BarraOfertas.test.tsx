import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LineaOfertas, TEXTOS_BARRA_OFERTAS, textoBarraOfertas } from "./BarraOfertas";
import { BarraSuperior } from "./BarraSuperior";
import { HREF_OFERTAS } from "@/lib/catalogo-url";

describe("línea de ofertas de la barra de arriba", () => {
  it("sin campañas no hay línea; con una, su etiqueta; con varias, el genérico", () => {
    expect(textoBarraOfertas([])).toBeNull();
    expect(textoBarraOfertas([{ etiqueta: "Black Friday" }])).toBe("Black Friday");
    expect(textoBarraOfertas([{ etiqueta: "  " }])).toBe(TEXTOS_BARRA_OFERTAS.varias);
    expect(textoBarraOfertas([{ etiqueta: "A" }, { etiqueta: "B" }])).toBe(TEXTOS_BARRA_OFERTAS.varias);
  });

  it("dice OFERTAS en el resaltado, la etiqueta y enlaza a las ofertas; se ve en los dos tamaños", () => {
    const html = renderToStaticMarkup(<LineaOfertas texto="Black Friday" />);
    expect(html).toContain("text-highlight");
    expect(html).toContain("Black Friday");
    expect(html).toContain(`href="${HREF_OFERTAS.replace("&", "&amp;")}"`);
    expect(html).toContain(TEXTOS_BARRA_OFERTAS.ver);
    expect(html).not.toContain("hidden");
  });

  it("con `ofertas`, mientras llega el hueco la barra muestra el anuncio de siempre (mismo alto)", () => {
    const html = renderToStaticMarkup(
      <BarraSuperior anuncio="Envíos a todo el país" visibilidad="siempre" redes={[]} whatsapp="" ofertas />,
    );
    expect(html).toContain("Envíos a todo el país");
  });
});
