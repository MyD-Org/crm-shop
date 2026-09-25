import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RenderImage } from "@myd-org/ui";

let imagenNext: RenderImage;

beforeAll(async () => {
  // El renderer lee la lista al cargar el módulo (en la app la inlinea next.config).
  vi.stubEnv("HOSTS_IMAGENES", "media.plataforma.example");
  ({ imagenNext } = await import("./imagen-next"));
});

const html = (nodo: ReactNode) => renderToStaticMarkup(createElement("div", null, nodo));

describe("imagenNext", () => {
  it("cover: next/image con fill, sizes del DS, lazy y sin `fit` en el DOM", () => {
    const out = html(
      imagenNext({
        src: "/images/deco.webp",
        alt: "Deco",
        className: "absolute inset-0 -z-20 h-full w-full object-cover",
        sizes: "(min-width: 1024px) 50vw, 100vw",
        fit: "cover",
        "data-size": "big",
      }),
    );
    expect(out).toContain('src="/_next/image?url=%2Fimages%2Fdeco.webp');
    expect(out).toContain("srcSet=");
    expect(out).toContain('sizes="(min-width: 1024px) 50vw, 100vw"');
    expect(out).toContain('class="absolute inset-0 -z-20 h-full w-full object-cover"');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('data-size="big"');
    expect(out).not.toMatch(/\sfit=/);
    expect(out).not.toContain("fetchPriority");
  });

  it("cover con priority: carga ansiosa y prioridad alta", () => {
    const out = html(
      imagenNext({ src: "https://media.plataforma.example/hero.webp", alt: "", sizes: "100vw", fit: "cover", priority: true }),
    );
    expect(out).toContain("/_next/image?url=https%3A%2F%2Fmedia.plataforma.example%2Fhero.webp");
    expect(out).toContain('fetchPriority="high"');
    expect(out).not.toContain('loading="lazy"');
  });

  it("logo: ancho y alto nominales, data-logo y sizes", () => {
    const out = html(
      imagenNext({ src: "/images/marca.png", alt: "", className: "h-7 w-auto", sizes: "150px", fit: "logo", "data-logo": "Marca" }),
    );
    expect(out).toContain('width="300"');
    expect(out).toContain('height="56"');
    expect(out).toContain('sizes="150px"');
    expect(out).toContain('data-logo="Marca"');
    expect(out).toContain('draggable="false"');
    // La cinta los hace entrar desde el borde: con lazy se veían los separadores solos.
    expect(out).not.toContain('loading="lazy"');
  });

  it("logo fuera de la lista de hosts: también carga inmediata", () => {
    const out = html(imagenNext({ src: "https://otro.example/logo.webp", alt: "", sizes: "150px", fit: "logo" }));
    expect(out).toContain('loading="eager"');
  });

  it("host fuera de la lista: <img> común (next/image daría 400)", () => {
    const out = html(
      imagenNext({ src: "https://otro.example/a.webp", alt: "A", sizes: "100vw", fit: "cover", "data-x": "1" }),
    );
    expect(out).toContain('src="https://otro.example/a.webp"');
    expect(out).not.toContain("/_next/image");
    expect(out).not.toContain("srcSet");
    expect(out).not.toMatch(/\ssizes=/);
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
    expect(out).toContain('data-x="1"');
  });
});

describe("HomeClient usa los renderers de Next", () => {
  const texto = readFileSync(fileURLToPath(new URL("../HomeClient.tsx", import.meta.url)), "utf8");

  it("pasa renderImage a Hero, Marquee, PromoBanner y los 3 RoomTiles", () => {
    expect(texto.match(/renderImage=\{imagenNext\}/g)).toHaveLength(6);
  });

  it("no precarga el hero a mano (lo hace next/image una sola vez)", () => {
    expect(texto).not.toMatch(/\bpreload\(/);
    expect(texto).not.toContain('from "react-dom"');
  });
});
