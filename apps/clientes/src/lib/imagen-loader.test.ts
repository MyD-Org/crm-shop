import { describe, expect, it } from "vitest";
import cargadorImagen from "./imagen-loader";

const foto = (ancho: number) => `https://medios.example/productos/central-led/351/ebb2960b-6b12-45ec-8291-3206ea1d4ef9-${ancho}.webp`;

describe("cargadorImagen", () => {
  it("pide la variante más chica que cubre el ancho", () => {
    expect(cargadorImagen({ src: foto(1600), width: 256 })).toBe(foto(320));
    expect(cargadorImagen({ src: foto(1600), width: 320 })).toBe(foto(320));
    expect(cargadorImagen({ src: foto(1600), width: 640 })).toBe(foto(800));
    expect(cargadorImagen({ src: foto(1600), width: 1080 })).toBe(foto(1600));
  });

  it("por encima de 1600 se queda con la de 1600", () => {
    expect(cargadorImagen({ src: foto(1600), width: 3840 })).toBe(foto(1600));
  });

  it("nunca pide una variante más grande que la que llega (puede no existir)", () => {
    expect(cargadorImagen({ src: foto(800), width: 1080 })).toBe(foto(800));
    expect(cargadorImagen({ src: foto(800), width: 640 })).toBe(foto(800));
    expect(cargadorImagen({ src: foto(800), width: 256 })).toBe(foto(320));
    expect(cargadorImagen({ src: foto(320), width: 1600 })).toBe(foto(320));
  });

  it("otras URLs van tal cual (nunca por el optimizador)", () => {
    expect(cargadorImagen({ src: "/images/hero-neutral.webp", width: 828 })).toBe("/images/hero-neutral.webp");
    expect(cargadorImagen({ src: "https://medios.example/home/hero.jpg", width: 828 })).toBe("https://medios.example/home/hero.jpg");
    const logo = "https://medios.example/home/central-led/48d9ae91-da35-476b-9aaa-c8306efd9b49-1600.webp";
    expect(cargadorImagen({ src: logo, width: 320 })).toBe(logo);
  });

  describe("imágenes de la home con variantes (home/{tenant}/v/…)", () => {
    const home = (ancho: number) => `https://medios.example/home/central-led/v/48d9ae91-da35-476b-9aaa-c8306efd9b49-${ancho}.webp`;

    it("elige 800 o 1600 según el ancho, sin bajar de 800", () => {
      expect(cargadorImagen({ src: home(1600), width: 256 })).toBe(home(800));
      expect(cargadorImagen({ src: home(1600), width: 800 })).toBe(home(800));
      expect(cargadorImagen({ src: home(1600), width: 1080 })).toBe(home(1600));
      expect(cargadorImagen({ src: home(1600), width: 3840 })).toBe(home(1600));
    });

    it("si la URL es la de 800 (imagen chica) nunca pide la de 1600", () => {
      expect(cargadorImagen({ src: home(800), width: 1080 })).toBe(home(800));
      expect(cargadorImagen({ src: home(800), width: 256 })).toBe(home(800));
    });

    it("las viejas (sin v/) siguen tal cual: no tienen -800", () => {
      const vieja = "https://medios.example/home/central-led/48d9ae91-da35-476b-9aaa-c8306efd9b49-1600.webp";
      expect(cargadorImagen({ src: vieja, width: 256 })).toBe(vieja);
    });
  });
});
