import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModoEdicionProvider } from "./ModoEdicion";
import { SeccionEditable } from "./SeccionEditable";

/**
 * IMG-6 (performance-mobile-shop): al visitante no le viajan los datos del
 * editor en el payload de la home. Desde 4a SeccionEditable no recibe datos
 * ni permiso por props: `puedeEditar` sale del contexto (solo lo prende el
 * hueco `EdicionSiAdmin`) y el Dialog pide la sección al abrirse.
 */

const HOME_CLIENT = fileURLToPath(new URL("../HomeClient.tsx", import.meta.url));

type Props = ComponentProps<typeof SeccionEditable>;

/** La sección con un párrafo adentro (el children va aparte). */
function renderizarElemento(props: Omit<Props, "children">) {
  return createElement(SeccionEditable, props as Props, createElement("p", null, "Contenido"));
}
function renderizar(props: Omit<Props, "children">): string {
  return renderToStaticMarkup(renderizarElemento(props));
}

describe("SeccionEditable para el visitante", () => {
  it("sin provider renderiza sólo el contenido, sin markup del editor", () => {
    expect(renderizar({ seccion: "hero" })).toBe("<p>Contenido</p>");
  });

  it("con ModoEdicionProvider (así lo monta page.tsx) el HTML inicial es el mismo", () => {
    const html = renderToStaticMarkup(
      createElement(ModoEdicionProvider, null, renderizarElemento({ seccion: "hero" })),
    );
    expect(html).toBe("<p>Contenido</p>");
  });

  it("respeta la visibilidad por tamaño y 'nunca'", () => {
    const soloDesktop = renderizar({ seccion: "marquee", visibilidad: "desktop" });
    expect(soloDesktop).toContain("<p>Contenido</p>");
    expect(soloDesktop).not.toContain("data-editor");

    expect(renderizar({ seccion: "marquee", visibilidad: "nunca" })).toBe("");
  });
});

describe("HomeClient no manda los datos del editor", () => {
  it("ninguna de las 8 SeccionEditable recibe `inicial` ni `puedeEditar`", () => {
    const texto = readFileSync(HOME_CLIENT, "utf8");
    const aperturas = texto.match(/<SeccionEditable[^>]*>/g) ?? [];
    expect(aperturas).toHaveLength(8);
    for (const tag of aperturas) {
      expect(tag).not.toMatch(/inicial=|puedeEditar=/);
    }
  });
});
