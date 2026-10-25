import { describe, expect, it } from "vitest";
import cargadorImagen from "./imagen-loader";

const foto = (ancho: number) => `https://medios.example/productos/central-led/351/ebb2960b-6b12-45ec-8291-3206ea1d4ef9-${ancho}.webp`;

describe("cargadorImagen", () => {
  it("pide la variante más chica que cubre el ancho", () => {
    expect(cargadorImagen({ src: foto(1600), width: 256 })).toBe(foto(320));
    expect(cargadorImagen({ src: foto(1600), width: 320 })).toBe(foto(320));
    expect(cargadorImagen({ src: foto(1600), width: 640 })).toBe(foto(800));
    expect(cargadorImagen({ src: foto(320), width: 1080 })).toBe(foto(1600));
  });

  it("por encima de 1600 se queda con la de 1600", () => {
    expect(cargadorImagen({ src: foto(800), width: 3840 })).toBe(foto(1600));
  });

  it("otras URLs van tal cual (nunca por el optimizador)", () => {
    expect(cargadorImagen({ src: "/images/hero-neutral.webp", width: 828 })).toBe("/images/hero-neutral.webp");
    expect(cargadorImagen({ src: "https://medios.example/home/hero.jpg", width: 828 })).toBe("https://medios.example/home/hero.jpg");
  });
});
