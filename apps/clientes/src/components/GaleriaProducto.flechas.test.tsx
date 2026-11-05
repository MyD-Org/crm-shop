import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FlechaGaleria, GaleriaProducto } from "./GaleriaProducto";

const foto = (n: number) => ({ url: `https://medios.cliente.example/f${n}.jpg`, w: 800 });

describe("flechas de la galería de la ficha", () => {
  it("con varias fotos, la primera muestra sólo «Foto siguiente»", () => {
    const html = renderToStaticMarkup(<GaleriaProducto fotos={[foto(1), foto(2)]} nombre="Lámpara" />);
    expect(html).toContain('aria-label="Foto siguiente"');
    expect(html).not.toContain('aria-label="Foto anterior"');
  });

  it("con una sola foto no hay flechas", () => {
    const html = renderToStaticMarkup(<GaleriaProducto fotos={[foto(1)]} nombre="Lámpara" />);
    expect(html).not.toContain("Foto siguiente");
  });

  it("sólo se ven con puntero fino (compu) y nombran un video si lo es", () => {
    const html = renderToStaticMarkup(
      <FlechaGaleria
        hacia="next"
        item={{ tipo: "video", id: "dQw4w9WgXcQ", embed: "e", poster: "p", posterRespaldo: "r" }}
        onClick={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Video siguiente"');
    expect(html).toContain("hidden");
    expect(html).toContain("pointer-fine:flex");
  });
});
