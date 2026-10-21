import { describe, expect, it } from "vitest";
import {
  BLOQUES_POR_NIVEL,
  claveDeMarca,
  contenidoInicial,
  esSlugMarca,
  itemsMenuMarcas,
  ordenarPaginas,
  sanearPaginaMarca,
  slugDeNombre,
  validarBloqueMarca,
  validarPaginaMarca,
  visibilidadBloque,
  type PaginaMarca,
} from "./pagina-marca";

const HOSTS = ["media.cliente.example"];

function pagina(extra: Partial<PaginaMarca> = {}): PaginaMarca {
  return {
    slug: "acme",
    nombre: "Acme",
    nivel: "marca",
    publicada: true,
    orden: 1,
    marcasCatalogo: ["ACME"],
    bajada: "Fabricantes de prueba.",
    bloques: {},
    visibilidad: {},
    ...extra,
  };
}

describe("slugs", () => {
  it("acepta un slug en minúsculas con guiones", () => {
    expect(esSlugMarca("led-premium")).toBe(true);
  });
  it("rechaza mayúsculas, espacios, guion inicial y más de 60 caracteres", () => {
    expect(esSlugMarca("Led Premium")).toBe(false);
    expect(esSlugMarca("-x")).toBe(false);
    expect(esSlugMarca("a".repeat(61))).toBe(false);
  });
  it("arma el slug desde el nombre sin tildes", () => {
    expect(slugDeNombre("Led Prémium")).toBe("led-premium");
    expect(slugDeNombre("  Macro LED  ")).toBe("macro-led");
  });
  it("la clave de la fila lleva el prefijo propio", () => {
    expect(claveDeMarca("acme")).toBe("pagina-marca:acme");
  });
});

describe("sanearPaginaMarca", () => {
  it("sanear degrada basura a null", () => {
    expect(sanearPaginaMarca(null)).toBeNull();
    expect(sanearPaginaMarca({})).toBeNull();
    expect(sanearPaginaMarca({ slug: "x", nombre: "<b>", nivel: "otro" })).toBeNull();
  });
  it("limpia marcado en los textos de los bloques", () => {
    const p = sanearPaginaMarca({
      ...pagina({ nivel: "oficial" }),
      bloques: { hero: { sello: "<script>x</script>Hola" } },
    });
    expect(p?.bloques.hero?.sello).toBe("xHola");
  });
  it("descarta bloques que no corresponden al nivel", () => {
    const p = sanearPaginaMarca({
      ...pagina({ nivel: "marca" }),
      bloques: { obras: { titulo: "Obras", fotos: [] } },
    });
    expect(p?.bloques.obras).toBeUndefined();
  });
  it("descarta visibilidades desconocidas y de bloques ajenos", () => {
    const p = sanearPaginaMarca({ ...pagina(), visibilidad: { hero: "nunca", lineas: "raro", obras: "nunca" } });
    expect(p?.visibilidad).toEqual({ hero: "nunca" });
  });
  it("una página sin publicada booleana queda no publicada", () => {
    expect(sanearPaginaMarca({ ...pagina(), publicada: "si" })?.publicada).toBe(false);
  });
});

describe("validarPaginaMarca", () => {
  it("una página completa es válida", () => {
    expect(validarPaginaMarca(pagina(), HOSTS)).toEqual([]);
  });
  it("exige al menos un valor de marca del catálogo", () => {
    expect(validarPaginaMarca(pagina({ marcasCatalogo: [] }), HOSTS)).toContain(
      "Elija al menos un valor de marca del catálogo.",
    );
  });
  it("rechaza un acento sin contraste sobre el fondo oscuro", () => {
    const errores = validarPaginaMarca(pagina({ acento: "#222222" }), HOSTS);
    expect(errores.some((e) => e.includes("contraste"))).toBe(true);
  });
  it("acepta el dorado por defecto", () => {
    expect(validarPaginaMarca(pagina({ acento: "#c0a15a" }), HOSTS)).toEqual([]);
  });
  it("rechaza un logo http o de un host ajeno", () => {
    expect(validarPaginaMarca(pagina({ logo: "http://media.cliente.example/a.webp" }), HOSTS).length).toBeGreaterThan(0);
    expect(validarPaginaMarca(pagina({ logo: "https://otro.example/a.webp" }), HOSTS).length).toBeGreaterThan(0);
    expect(validarPaginaMarca(pagina({ logo: "https://media.cliente.example/a.webp" }), HOSTS)).toEqual([]);
  });
  it("rechaza un slug inválido", () => {
    expect(validarPaginaMarca(pagina({ slug: "Mal Slug" }), HOSTS).length).toBeGreaterThan(0);
  });
});

describe("validarBloqueMarca", () => {
  it("confianza admite hasta 4 ítems", () => {
    const items = Array.from({ length: 5 }, () => ({ valor: "+1", texto: "x" }));
    expect(validarBloqueMarca("confianza", { items }, HOSTS).length).toBeGreaterThan(0);
    expect(validarBloqueMarca("confianza", { items: items.slice(0, 4) }, HOSTS)).toEqual([]);
  });
  it("elegidos exige cantidad entre 1 y 12", () => {
    expect(validarBloqueMarca("elegidos", { titulo: "x", skus: [], cantidad: 0 }, HOSTS).length).toBeGreaterThan(0);
    expect(validarBloqueMarca("elegidos", { titulo: "x", skus: ["A1"], cantidad: 8 }, HOSTS)).toEqual([]);
  });
  it("una línea necesita título y slug válido", () => {
    const linea = { slug: "piscinas", titulo: "Piscinas", categorias: ["Piscinas"], skus: [] };
    expect(validarBloqueMarca("lineas", { items: [linea] }, HOSTS)).toEqual([]);
    expect(validarBloqueMarca("lineas", { items: [{ ...linea, titulo: "" }] }, HOSTS).length).toBeGreaterThan(0);
  });
  it("cotización exige mensaje y botón", () => {
    expect(validarBloqueMarca("cotizacion", { titulo: "x", boton: "", mensaje: "" }, HOSTS).length).toBeGreaterThan(0);
  });
});

describe("contenido inicial y visibilidad", () => {
  it("el mensaje de cotización usa el nombre de la marca", () => {
    expect(contenidoInicial("oficial", "Acme").cotizacion?.mensaje).toBe(
      "Hola, quiero cotizar una obra con productos Acme.",
    );
  });
  it("el nivel marca no trae bloques de tienda oficial", () => {
    const inicial = contenidoInicial("marca", "Acme");
    expect(Object.keys(inicial).every((b) => BLOQUES_POR_NIVEL.marca.includes(b as never))).toBe(true);
  });
  it("líneas arranca oculta en el nivel marca y visible en el oficial", () => {
    expect(visibilidadBloque(pagina({ nivel: "marca" }), "lineas")).toBe("nunca");
    expect(visibilidadBloque(pagina({ nivel: "oficial" }), "lineas")).toBe("siempre");
    expect(visibilidadBloque(pagina({ visibilidad: { lineas: "desktop" } }), "lineas")).toBe("desktop");
  });
});

describe("orden y menú", () => {
  const marca = pagina({ slug: "macro", nombre: "Macro", orden: 1 });
  const oficial = pagina({ slug: "acme", nombre: "Acme", nivel: "oficial", orden: 5, bajada: "Fábrica" });
  const oculta = pagina({ slug: "oculta", nombre: "Oculta", publicada: false, orden: 0 });

  it("la oficial va primero y después por orden", () => {
    expect(ordenarPaginas([marca, oculta, oficial]).map((p) => p.slug)).toEqual(["acme", "oculta", "macro"]);
  });
  it("el menú lista solo publicadas, la oficial destacada y cierra con Ver todas", () => {
    expect(itemsMenuMarcas([marca, oficial, oculta])).toEqual([
      { label: "Acme", href: "/marcas/acme", destacado: true, descripcion: "Fábrica" },
      { label: "Macro", href: "/marcas/macro" },
      { label: "Ver todas las marcas", href: "/marcas" },
    ]);
  });
  it("sin páginas publicadas el menú queda vacío", () => {
    expect(itemsMenuMarcas([])).toEqual([]);
    expect(itemsMenuMarcas([oculta])).toEqual([]);
  });
});

describe("bloque La empresa (fotos y videos)", () => {
  it("es de la tienda oficial, entre componentes y obras", () => {
    const orden = BLOQUES_POR_NIVEL.oficial;
    expect(orden.indexOf("empresa")).toBe(orden.indexOf("componentes") + 1);
    expect(orden.indexOf("obras")).toBe(orden.indexOf("empresa") + 1);
    expect(BLOQUES_POR_NIVEL.marca).not.toContain("empresa");
  });

  it("acepta fotos y videos de YouTube o Vimeo; rechaza otros videos", () => {
    const foto = { tipo: "foto", imagen: "https://media.cliente.example/f.webp", alt: "La planta" };
    const video = { tipo: "video", url: "https://youtu.be/abcDEF12345" };
    expect(validarBloqueMarca("empresa", { titulo: "La fábrica", items: [foto, video] }, HOSTS)).toEqual([]);
    expect(
      validarBloqueMarca("empresa", { titulo: "x", items: [{ tipo: "video", url: "https://otro.example/v.mp4" }] }, HOSTS)[0],
    ).toMatch(/YouTube o Vimeo/);
  });

  it("sanear descarta ítems rotos y conserva el tipo", () => {
    const p = sanearPaginaMarca({
      ...pagina({ nivel: "oficial" }),
      bloques: {
        empresa: {
          titulo: "La fábrica",
          items: [
            { tipo: "video", url: "https://www.youtube.com/watch?v=abcDEF12345" },
            { tipo: "video", url: "javascript:alert(1)" },
            { tipo: "foto", imagen: "/images/x.webp", alt: "Planta" },
            { tipo: "otro" },
          ],
        },
      },
    });
    expect(p?.bloques.empresa?.items).toEqual([
      { tipo: "video", url: "https://www.youtube.com/watch?v=abcDEF12345" },
      { tipo: "foto", imagen: "/images/x.webp", alt: "Planta" },
    ]);
  });
});

describe("cotización configurable", () => {
  it("WhatsApp con número propio o enlace", () => {
    const base = { titulo: "Obras", boton: "Cotizar", mensaje: "Hola" };
    expect(validarBloqueMarca("cotizacion", { ...base, destino: "whatsapp", whatsapp: "+54 9 223 555-1234" }, HOSTS)).toEqual([]);
    expect(validarBloqueMarca("cotizacion", { ...base, destino: "whatsapp", whatsapp: "123" }, HOSTS)[0]).toMatch(/WhatsApp/);
    expect(validarBloqueMarca("cotizacion", { ...base, destino: "enlace", href: "/contacto" }, HOSTS)).toEqual([]);
    expect(validarBloqueMarca("cotizacion", { ...base, destino: "enlace", href: "mailto:ventas@cliente.example" }, HOSTS)).toEqual([]);
    expect(validarBloqueMarca("cotizacion", { ...base, destino: "enlace", href: "javascript:alert(1)" }, HOSTS).length).toBeGreaterThan(0);
    expect(validarBloqueMarca("cotizacion", { ...base, destino: "enlace" }, HOSTS).length).toBeGreaterThan(0);
  });

  it("con enlace el mensaje no es obligatorio", () => {
    expect(validarBloqueMarca("cotizacion", { titulo: "Obras", boton: "Cotizar", mensaje: "", destino: "enlace", href: "/contacto" }, HOSTS)).toEqual([]);
  });
});
