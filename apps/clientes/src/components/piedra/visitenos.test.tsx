import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/home-acciones", () => ({
  guardarSeccion: vi.fn(),
  leerSeccionParaEditar: vi.fn(),
  cambiarVisibilidadSeccion: vi.fn(),
}));

import {
  DEFAULTS_HOME,
  ORDEN_HOME,
  SECCIONES_HOME,
  combinarContenidoHome,
  defaultsHomeGenerica,
  erroresSeccion,
  type HomeContent,
  type VisitenosContent,
} from "@/data/home-defaults";
import { completarOrden } from "@/lib/orden-secciones";
import { TITULOS_SECCION, normalizarPayload } from "@/lib/home-editor";
import { HomeClient } from "../HomeClient";
import { EDITORES } from "../home/editores";
import { EditorVisitenos } from "../home/editores/EditorVisitenos";

// Datos de ejemplo: dominios reservados .example, nada de direcciones reales.
const LOCAL: VisitenosContent = {
  titulo: "Visítenos en *Mar del Plata*",
  direccion: "Calle Ejemplo 123, Ciudad Ejemplo",
  horarios: "Lunes a viernes de 9 a 18\nSábados de 9 a 13",
  cta: { label: "Cómo llegar", href: "https://mapa.example/local" },
};

const home = (contenido: HomeContent, piedra?: boolean) =>
  renderToStaticMarkup(
    createElement(HomeClient, { contenido, destacados: null, tiendaOficial: null, promociones: null, busquedaAsistida: null, ...(piedra === undefined ? {} : { piedra }) }),
  );
const conVisitenos = (visibilidad: "siempre" | "nunca" | "desktop", extra: Partial<VisitenosContent> = {}): HomeContent => ({
  ...DEFAULTS_HOME,
  visitenos: { ...LOCAL, ...extra },
  visibilidad: { ...DEFAULTS_HOME.visibilidad, visitenos: visibilidad },
});

describe("la sección visitenos en el contrato de la home", () => {
  it("es una sección más: ordenable, editable y con título en usted", () => {
    expect(SECCIONES_HOME).toContain("visitenos");
    expect(ORDEN_HOME).toContain("visitenos");
    expect(TITULOS_SECCION.visitenos).toBe("Visítenos");
    expect(EDITORES.visitenos).toBe(EditorVisitenos);
  });

  it("nace oculta ('nunca') en el sitio principal y en los genéricos", () => {
    expect(DEFAULTS_HOME.visibilidad.visitenos).toBe("nunca");
    expect(defaultsHomeGenerica({ nombre: "Tienda" }).visibilidad.visitenos).toBe("nunca");
  });

  it("un orden guardado antes de que existiera la suma en su lugar, y la visibilidad sigue oculta", () => {
    const viejo = ORDEN_HOME.filter((s) => s !== "visitenos");
    const completo = completarOrden(viejo, ORDEN_HOME);
    expect(completo).toContain("visitenos");
    expect(completo.indexOf("visitenos")).toBeLessThan(completo.indexOf("whatsapp"));
    const c = combinarContenidoHome([
      { key: "orden", payload: { secciones: viejo } },
      { key: "ocultas", payload: { hero: "desktop" } },
    ]);
    expect(c.visibilidad.visitenos).toBe("nunca");
    expect(c.orden).toContain("visitenos");
  });

  it("la fila guardada pisa el default", () => {
    const c = combinarContenidoHome([{ key: "visitenos", payload: LOCAL }]);
    expect(c.visitenos.direccion).toBe(LOCAL.direccion);
  });

  it("no trae ninguna dirección ni enlace de código", () => {
    expect(DEFAULTS_HOME.visitenos.direccion).toBeUndefined();
    expect(DEFAULTS_HOME.visitenos.horarios).toBeUndefined();
    expect(DEFAULTS_HOME.visitenos.cta).toBeUndefined();
  });
});

describe("validación de visitenos", () => {
  it("acepta el contenido completo y el vacío", () => {
    expect(erroresSeccion("visitenos", LOCAL)).toEqual([]);
    expect(erroresSeccion("visitenos", {})).toEqual([]);
    expect(erroresSeccion("visitenos", { titulo: "Hola", cta: { label: "Ver", href: "/catalogo" } })).toEqual([]);
  });

  it("rechaza un enlace que no es https ni ruta interna", () => {
    for (const href of ["http://mapa.example", "javascript:alert(1)", "//mapa.example", "mapa.example"]) {
      expect(erroresSeccion("visitenos", { ...LOCAL, cta: { label: "Ir", href } }), href).not.toEqual([]);
    }
  });

  it("rechaza textos vacíos o demasiado largos", () => {
    expect(erroresSeccion("visitenos", { direccion: "   " })).not.toEqual([]);
    expect(erroresSeccion("visitenos", { direccion: "a".repeat(201) })).not.toEqual([]);
    expect(erroresSeccion("visitenos", { horarios: "a".repeat(401) })).not.toEqual([]);
    expect(erroresSeccion("visitenos", "x")).not.toEqual([]);
  });

  it("normalizar descarta el botón sin etiqueta y los textos vacíos", () => {
    const n = normalizarPayload("visitenos", { ...LOCAL, direccion: "  ", cta: { label: " ", href: "https://mapa.example" } }) as Record<string, unknown>;
    expect(n.cta).toBeUndefined();
    expect(n.direccion).toBeUndefined();
    expect(erroresSeccion("visitenos", n)).toEqual([]);
  });
});

describe("la home dibuja Visítenos sólo con la piedra prendida y la sección visible", () => {
  const sinSeccion = (c: HomeContent): HomeContent => ({ ...c, orden: c.orden.filter((s) => s !== "visitenos") });

  it("sin el interruptor, la home es idéntica a la de siempre aunque la sección esté visible", () => {
    for (const c of [DEFAULTS_HOME, conVisitenos("siempre")]) {
      expect(home(c)).toBe(home(sinSeccion(c)));
      expect(home(c, false)).toBe(home(sinSeccion(c)));
    }
    expect(home(conVisitenos("siempre"), false)).not.toMatch(/Visítenos|data-visitenos|Cómo llegar|Calle Ejemplo/);
  });

  it("con el interruptor pero oculta por defecto, tampoco aparece", () => {
    expect(home(DEFAULTS_HOME, true)).not.toMatch(/data-visitenos|Visítenos|Cómo llegar/);
    expect(home(conVisitenos("nunca"), true)).not.toContain("data-visitenos");
  });

  it("prendida y visible: título, dirección, horarios y el botón Cómo llegar a otra pestaña", () => {
    const h = home(conVisitenos("siempre"), true);
    expect(h).toContain("data-visitenos");
    expect(h).toContain("Mar del Plata");
    expect(h).toContain("Calle Ejemplo 123, Ciudad Ejemplo");
    expect(h).toContain("Lunes a viernes de 9 a 18");
    expect(h).toMatch(/<a [^>]*href="https:\/\/mapa\.example\/local"[^>]*>Cómo llegar<\/a>/);
    expect(h).toContain('rel="noopener noreferrer"');
    expect(h).toContain('target="_blank"');
  });

  it("'solo en desktop' se oculta por CSS en el celular", () => {
    const h = home(conVisitenos("desktop"), true);
    expect(h).toMatch(/max-md:hidden[^>]*>[\s\S]*data-visitenos/);
  });

  it("sin enlace o sin etiqueta no hay botón, y un enlace interno no abre otra pestaña", () => {
    expect(home(conVisitenos("siempre", { cta: undefined }), true)).not.toContain("Cómo llegar");
    const interno = home(conVisitenos("siempre", { cta: { label: "Ver", href: "/catalogo" } }), true);
    expect(interno).toMatch(/href="\/catalogo"[^>]*>Ver</);
    expect(interno.match(/target="_blank"/g)?.length ?? 0).toBe(home(conVisitenos("siempre", { cta: undefined }), true).match(/target="_blank"/g)?.length ?? 0);
  });

  it("respeta el orden elegido", () => {
    const orden = ["visitenos", ...DEFAULTS_HOME.orden.filter((s) => s !== "visitenos")] as HomeContent["orden"];
    const h = home({ ...conVisitenos("siempre"), orden }, true);
    expect(h.indexOf("data-visitenos")).toBeLessThan(h.indexOf("Consultar ahora"));
  });
});

describe("el editor de Visítenos", () => {
  it("pide dirección, horarios y el enlace en usted", () => {
    const h = renderToStaticMarkup(createElement(EditorVisitenos, { valor: LOCAL, onChange: () => {} }));
    for (const t of ["Dirección", "Horarios", "Etiqueta", "Enlace"]) expect(h).toContain(t);
    expect(h).toContain("Calle Ejemplo 123");
  });
});
