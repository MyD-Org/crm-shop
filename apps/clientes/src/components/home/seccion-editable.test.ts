import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeccionEditable } from "./SeccionEditable";

/**
 * IMG-6 (performance-mobile-shop): al visitante no le viajan los datos del
 * editor en el payload de la home. HomeClient pasa `inicial` sólo con
 * `puedeEditar`; SeccionEditable tiene que andar igual sin él.
 */

const HOME_CLIENT = fileURLToPath(new URL("../HomeClient.tsx", import.meta.url));

type Props = ComponentProps<typeof SeccionEditable>;

/** Renderiza la sección con un párrafo adentro (el children va aparte). */
function renderizar(props: Omit<Props, "children">): string {
  return renderToStaticMarkup(createElement(SeccionEditable, props as Props, createElement("p", null, "Contenido")));
}

describe("SeccionEditable sin `inicial` (visitante)", () => {
  it("renderiza sólo el contenido, sin markup del editor", () => {
    expect(renderizar({ seccion: "hero", puedeEditar: false })).toBe("<p>Contenido</p>");
  });

  it("respeta la visibilidad por tamaño y 'nunca'", () => {
    const soloDesktop = renderizar({ seccion: "marquee", puedeEditar: false, visibilidad: "desktop" });
    expect(soloDesktop).toContain("<p>Contenido</p>");
    expect(soloDesktop).not.toContain("data-editor");

    expect(renderizar({ seccion: "marquee", puedeEditar: false, visibilidad: "nunca" })).toBe("");
  });
});

describe("HomeClient no manda los datos del editor al visitante", () => {
  it("cada `inicial` de SeccionEditable depende de puedeEditar", () => {
    const texto = readFileSync(HOME_CLIENT, "utf8");
    const iniciales = texto.match(/inicial=\{[^}]*\}/g) ?? [];
    expect(iniciales).toHaveLength(8);
    for (const prop of iniciales) {
      expect(prop).toMatch(/^inicial=\{puedeEditar \? [\w.]+ : undefined\}$/);
    }
  });
});
