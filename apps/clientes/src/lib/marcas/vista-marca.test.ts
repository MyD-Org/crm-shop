import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaginaMarca } from "./pagina-marca";
import {
  filtrosDeMarca,
  hrefCotizacion,
  hrefLinea,
  leerEstadoMarca,
  metadataMarca,
  rutasSitemapMarcas,
  videoEmbebible,
} from "./vista-marca";

const lineas = {
  items: [{ slug: "piscinas", titulo: "Piscinas", categorias: ["Piscinas"], skus: ["P1"] }],
};

function pagina(extra: Partial<PaginaMarca> = {}): PaginaMarca {
  return {
    slug: "led-premium",
    nombre: "Led Premium",
    nivel: "oficial",
    publicada: true,
    orden: 1,
    marcasCatalogo: ["LED PREMIUM", "Led Premium"],
    bajada: "Fabricantes de iluminación LED profesional.",
    logo: "/images/marcas/acme.webp",
    bloques: { lineas },
    visibilidad: {},
    ...extra,
  };
}

describe("metadataMarca", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda.example"));
  afterEach(() => vi.unstubAllEnvs());

  it("sin NEXT_PUBLIC_SITE_URL no emite canonical ni imagen relativa (rompe el build)", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const m = metadataMarca(pagina(), "Central Led", false);
    expect(m.alternates).toBeUndefined();
    expect(m.openGraph?.images).toBeUndefined();
    expect(m.title).toEqual({ absolute: "Led Premium — Tienda oficial | Central Led" });
  });

  it("título de tienda oficial, descripción y canonical", () => {
    const m = metadataMarca(pagina(), "Central Led", false);
    expect(m.title).toEqual({ absolute: "Led Premium — Tienda oficial | Central Led" });
    expect(m.description).toBe("Fabricantes de iluminación LED profesional.");
    expect(m.alternates?.canonical).toBe("/marcas/led-premium");
    expect(m.robots).toBeUndefined();
    expect(m.openGraph?.images).toEqual(["/images/marcas/acme.webp"]);
  });

  it("nivel marca sin 'Tienda oficial'; el SEO propio gana", () => {
    expect(metadataMarca(pagina({ nivel: "marca" }), "Central Led", false).title).toEqual({
      absolute: "Led Premium | Central Led",
    });
    const m = metadataMarca(pagina({ seo: { titulo: "Propio", descripcion: "Desc" } }), "Central Led", false);
    expect(m.title).toEqual({ absolute: "Propio" });
    expect(m.description).toBe("Desc");
  });

  it("sin imagen propia ni logo usa la imagen general del sitio y repite el nombre de la tienda", () => {
    const m = metadataMarca(pagina({ logo: undefined }), "Central Led", false);
    expect(m.openGraph).toMatchObject({
      siteName: "Central Led",
      locale: "es_AR",
      images: ["/opengraph-image"],
    });
  });

  it("con query: noindex, follow", () => {
    expect(metadataMarca(pagina(), "Central Led", true).robots).toEqual({ index: false, follow: true });
  });
});

describe("filtros y estado", () => {
  it("filtrosDeMarca usa los valores crudos y nunca filtra stock", () => {
    const f = filtrosDeMarca(pagina());
    expect(f).toEqual({ marcasPropias: ["LED PREMIUM", "Led Premium"] });
    expect("soloStock" in f).toBe(false);
  });

  it("con una línea existente la suma; con una desconocida no", () => {
    expect(filtrosDeMarca(pagina(), "piscinas").linea).toEqual({ categorias: ["Piscinas"], skus: ["P1"] });
    expect(filtrosDeMarca(pagina(), "nada").linea).toBeUndefined();
  });

  it("leerEstadoMarca acota la página y valida la línea", () => {
    expect(leerEstadoMarca({ pagina: "0" }, pagina())).toEqual({ pagina: 1 });
    expect(leerEstadoMarca({ pagina: "3", linea: "piscinas" }, pagina())).toEqual({ pagina: 3, linea: "piscinas" });
    expect(leerEstadoMarca({ pagina: "x", linea: "otra" }, pagina())).toEqual({ pagina: 1 });
    expect(leerEstadoMarca({ pagina: ["2", "5"] }, pagina())).toEqual({ pagina: 2 });
  });
});

describe("hrefs", () => {
  it("hrefLinea va al bloque de productos", () => {
    expect(hrefLinea("led-premium", "piscinas")).toBe("/marcas/led-premium?linea=piscinas#productos");
    expect(hrefLinea("led-premium")).toBe("/marcas/led-premium#productos");
  });

});

describe("rutasSitemapMarcas", () => {
  it("sin publicadas no agrega nada; con publicadas, cada una (no hay índice /marcas)", () => {
    expect(rutasSitemapMarcas([])).toEqual([]);
    expect(rutasSitemapMarcas([pagina({ publicada: false })])).toEqual([]);
    expect(rutasSitemapMarcas([pagina()])).toEqual(["/marcas/led-premium"]);
  });
});

describe("hrefCotizacion", () => {
  const cot = { titulo: "Obras", boton: "Cotizar", mensaje: "Hola, quiero cotizar" };

  it("WhatsApp: el número propio del bloque le gana al de la tienda", () => {
    expect(hrefCotizacion({ ...cot, whatsapp: "5492235551234" }, "5493757000000")).toBe(
      "https://wa.me/5492235551234?text=Hola%2C%20quiero%20cotizar",
    );
    expect(hrefCotizacion(cot, "5493757000000")).toBe("https://wa.me/5493757000000?text=Hola%2C%20quiero%20cotizar");
  });

  it("sin número válido no hay botón", () => {
    expect(hrefCotizacion(cot, "")).toBeNull();
  });

  it("enlace: va tal cual", () => {
    expect(hrefCotizacion({ ...cot, destino: "enlace", href: "/contacto" }, "")).toBe("/contacto");
  });
});

describe("videoEmbebible", () => {
  it("YouTube (watch, youtu.be, shorts) y Vimeo", () => {
    expect(videoEmbebible("https://www.youtube.com/watch?v=abcDEF12345&t=3")).toEqual({
      proveedor: "youtube",
      id: "abcDEF12345",
      embed: "https://www.youtube-nocookie.com/embed/abcDEF12345",
      poster: "https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg",
    });
    expect(videoEmbebible("https://youtu.be/abcDEF12345")?.id).toBe("abcDEF12345");
    expect(videoEmbebible("https://youtube.com/shorts/abcDEF12345")?.id).toBe("abcDEF12345");
    expect(videoEmbebible("https://vimeo.com/123456789")).toEqual({
      proveedor: "vimeo",
      id: "123456789",
      embed: "https://player.vimeo.com/video/123456789",
    });
  });

  it("cualquier otra cosa: null", () => {
    expect(videoEmbebible("https://otro.example/video.mp4")).toBeNull();
    expect(videoEmbebible("javascript:alert(1)")).toBeNull();
    expect(videoEmbebible("http://www.youtube.com/watch?v=abcDEF12345")).toBeNull();
  });
});
