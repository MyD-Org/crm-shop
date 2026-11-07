import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarraSuperior } from "@/components/BarraSuperior";
import { DEFAULTS_FOOTER, defaultsFooterDe } from "@/data/footer";
import { DEFAULTS_LEGAL, defaultsHomeDe } from "@/data/home-defaults";
import { base } from "./institucional/base";
import { columnasFooter } from "./legales/footer";
import { bloquesArrepentimiento } from "./legales/arrepentimiento";
import { bloquesPrivacidad } from "./legales/privacidad";
import { bloquesTerminos } from "./legales/terminos";
import { avatarChat } from "./chat-ia-textos";
import { manifestDeMarca } from "./manifest-marca";
import { MARCA_POR_DEFECTO, altLogo, fuenteLogo, idTecnico, partesNombre, resolverMarca, resolverMarcaPropia, type Marca } from "./marca-base";
import { destinoFavicon, metadataDeMarca } from "./metadata-marca";
import { resolverSitio } from "./sitio";
import { coloresPwaDeTema, sanearTemaTenant } from "./tema-tenant";
import { urlLogoMarca } from "./vinculacion-mail";

/**
 * Anti-fuga: la misma tienda se sirve desde dos dominios. El sitio con marca propia no puede
 * mostrar NADA de Central (nombre, rutas de logos e íconos, textos); el principal queda como hoy.
 * Los dominios son de ejemplo (.example).
 */
const SHOP_MARCA_PRINCIPAL = {};
const EXTRAS = [
  {
    etiqueta: "tienda-b",
    url: "https://tienda-b.example",
    // Marca PARCIAL a propósito: sin logo ni textos, para ver que no cae a lo de Central.
    marca: { nombre: "Tienda B", descripcion: "Lámparas y más." },
    remitente: "pedidos@tienda-b.example",
  },
];

function marcaDe(siteUrl: string): Marca {
  const sitio = resolverSitio(siteUrl, EXTRAS);
  return sitio.propio ? resolverMarcaPropia(sitio.marca, "Tienda B") : resolverMarca(SHOP_MARCA_PRINCIPAL);
}

/** Todo lo que el Shop deriva de la marca para el HTML, el manifest, los mails y el chat. */
function salidas(marca: Marca) {
  return {
    metadata: metadataDeMarca(marca, { siteUrl: "https://tienda-b.example" }),
    manifest: manifestDeMarca(marca, coloresPwaDeTema(sanearTemaTenant(null))),
    favicon: destinoFavicon(marca),
    logoHeader: { fuente: fuenteLogo(marca), alt: altLogo(marca), partes: partesNombre(marca) },
    logoMail: urlLogoMarca(marca, "https://tienda-b.example"),
    avatarChat: avatarChat(marca) ?? null,
    userAgent: idTecnico(marca),
  };
}

describe("sin fugas de Central en el sitio con marca propia", () => {
  const b = marcaDe("https://tienda-b.example");
  const json = JSON.stringify(salidas(b));

  it("la marca del sitio es genérica y no tiene los recursos de Central", () => {
    expect(b.recursosCentral).toBe(false);
    expect(b.nombre).toBe("Tienda B");
  });

  it("metadata, manifest, favicon, logos, mail y chat no nombran a Central", () => {
    expect(json).not.toMatch(/central|centralled|iguaz/i);
    expect(json).not.toContain("/images/central-led");
  });

  it("declara el ícono neutro y el header va con el nombre en texto", () => {
    const s = salidas(b);
    expect(s.favicon).toBe("/images/generica/icon.svg");
    expect(s.logoHeader.fuente).toBe("texto");
    expect(s.logoMail).toBeNull();
    expect(s.avatarChat).toBeNull();
    expect(s.metadata.title).toBe("Tienda B — Tienda Online");
  });
});

describe("sin fugas de Central en el contenido del sitio con marca propia (home, footer, legales)", () => {
  const b = marcaDe("https://tienda-b.example");
  const footer = defaultsFooterDe(b);
  const salida = JSON.stringify({
    home: defaultsHomeDe(b),
    footer,
    columnas: columnasFooter({ arrepentimiento: true, footer, paginas: [] }),
    barra: renderToStaticMarkup(createElement(BarraSuperior, { anuncio: undefined, visibilidad: "siempre", redes: footer.redes, whatsapp: footer.whatsapp })),
    legales: [
      bloquesTerminos(DEFAULTS_LEGAL, { cuotas: false }),
      bloquesPrivacidad(DEFAULTS_LEGAL),
      bloquesArrepentimiento(DEFAULTS_LEGAL),
      base("nosotros", b, DEFAULTS_LEGAL, footer.whatsapp),
    ],
  });

  it("no nombra a Central ni usa sus rutas", () => {
    expect(salida).not.toMatch(/central|centralled|iguaz/i);
    expect(salida).not.toContain("/images/central-led");
  });

  it("el footer es mínimo: sin redes, locales, WhatsApp ni enlaces, y la barra sin dirección", () => {
    expect(footer.redes).toEqual([]);
    expect(footer.locales).toEqual([]);
    expect(footer.enlaces).toEqual([]);
    expect(footer.whatsapp).toBe("");
    expect(footer.barraDerecha).toBe("");
    expect(DEFAULTS_LEGAL).toEqual({});
  });

  it("sin Instagram propio la barra superior no existe", () => {
    expect(renderToStaticMarkup(createElement(BarraSuperior, { anuncio: undefined, visibilidad: "siempre", redes: footer.redes, whatsapp: "" }))).toBe("");
  });
});

describe("el sitio principal queda igual que hoy", () => {
  it("el footer de Central es DEFAULTS_FOOTER, la misma referencia", () => {
    expect(defaultsFooterDe(MARCA_POR_DEFECTO)).toBe(DEFAULTS_FOOTER);
  });

  it("cliente.example y un sitio desconocido usan la marca y los recursos de Central", () => {
    for (const url of ["https://cliente.example", "https://otro.example", undefined]) {
      const m = marcaDe(url as string);
      expect(m).toEqual(MARCA_POR_DEFECTO);
      const s = salidas(m);
      expect(s.favicon).toBe("/images/central-led/favicon.ico");
      expect(s.logoHeader.fuente).toBe("central");
      expect(s.logoMail).toBe("https://tienda-b.example/images/central-led/logo-mail.png");
      expect(s.avatarChat).toBe("/images/central-led/avatar.jpg");
      expect(s.metadata.title).toBe("Central LED — Tienda Online");
    }
  });
});
