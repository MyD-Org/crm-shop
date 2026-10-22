import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { DEFAULTS_HOME } from "@/data/home-defaults";
import { HomeClient } from "./HomeClient";

/** "Ordenar secciones": la home dibuja el cuerpo en el orden guardado (`contenido.orden`). */
const html = (orden = DEFAULTS_HOME.orden) =>
  renderToStaticMarkup(
    createElement(HomeClient, {
      contenido: { ...DEFAULTS_HOME, orden },
      destacados: createElement("p", null, "MARCA-DESTACADOS"),
      tiendaOficial: createElement("p", null, "MARCA-TIENDA-OFICIAL"),
      busquedaAsistida: createElement("p", null, "MARCA-BUSQUEDA"),
    }),
  );

describe("HomeClient en el orden guardado", () => {
  it("por defecto, destacados antes que la tienda oficial y el WhatsApp al final", () => {
    const h = html();
    expect(h.indexOf("MARCA-DESTACADOS")).toBeLessThan(h.indexOf("MARCA-TIENDA-OFICIAL"));
    expect(h.indexOf("MARCA-TIENDA-OFICIAL")).toBeLessThan(h.indexOf("Consultar ahora"));
  });

  it("con otro orden, lo respeta", () => {
    const h = html(["whatsapp", "tiendaOficial", "hero", "marquee", "busquedaAsistida", "ambientes", "destacados", "bannerDeco", "decoGrid", "servicios"]);
    expect(h.indexOf("Consultar ahora")).toBeLessThan(h.indexOf("MARCA-TIENDA-OFICIAL"));
    expect(h.indexOf("MARCA-TIENDA-OFICIAL")).toBeLessThan(h.indexOf("MARCA-DESTACADOS"));
    expect(h.indexOf("MARCA-BUSQUEDA")).toBeLessThan(h.indexOf("MARCA-DESTACADOS"));
  });
});
