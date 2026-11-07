import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La textura de piedra fuera del hero (login, pie, 404, carrito vacío): sólo con `piedra: true`.
 * Apagada, la salida es la de siempre (caracterización) y nada de la piedra se filtra al HTML.
 * Dominios de ejemplo (.example).
 */
const { decoracion, estado } = vi.hoisted(() => ({ decoracion: { piedra: false }, estado: { items: [] as unknown[] } }));

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/home-datos", () => ({
  getDecoracion: async () => ({ ...decoracion }),
  getDatosFooter: async () => (await import("@/data/footer")).DEFAULTS_FOOTER,
  getDatosLegales: async () => ({}),
}));
vi.mock("@/lib/marca", async () => ({ getMarca: async () => (await import("@/lib/marca-base")).MARCA_POR_DEFECTO }));
vi.mock("@/lib/institucional/datos", () => ({ getPaginasPublicadas: async () => [] }));
vi.mock("@/components/footer/BotonEditarFooterSiAdmin", () => ({ BotonEditarFooterSiAdmin: () => null }));
vi.mock("@clerk/nextjs", () => ({
  ClerkLoaded: ({ children }: { children: unknown }) => children,
  ClerkLoading: () => null,
  useAuth: () => ({ userId: null }),
  SignIn: () => createElement("div", { "data-clerk": "sign-in" }),
  SignUp: () => createElement("div", { "data-clerk": "sign-up" }),
}));
vi.mock("@/components/FormularioClerkCargando", () => ({ FormularioClerkCargando: () => null }));
vi.mock("@/context/CartContext", () => ({
  useCart: () => ({ items: estado.items, updateQty: vi.fn(), removeItem: vi.fn(), restoreItem: vi.fn(), ready: true, cupon: null, setCupon: vi.fn() }),
}));
vi.mock("@/hooks/useCotizacion", () => ({
  useCotizacion: () => ({ cotizacion: null, estado: "idle", error: null, recotizar: vi.fn(), ultimasLineas: [], ultimoProgresoCuotas: null }),
}));

import { EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { CarritoClient } from "@/components/CarritoClient";
import { SiteFooter } from "@/components/SiteFooter";
import NotFound from "@/app/not-found";
import IngresarPage from "@/app/ingresar/[[...rest]]/page";
import RegistroPage from "@/app/registro/[[...rest]]/page";
import { BloquePiedra } from "./BloquePiedra";
import { FondoPiedra } from "./FondoPiedra";
import { OPACIDAD_PIE, TexturaPie, claseDelPie } from "./TexturaPie";
import { PiedraDecorativa } from "./PiedraDecorativa";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const prendida = () => { decoracion.piedra = true; };
const apagada = () => { decoracion.piedra = false; };

/** Lo que dibuja la piedra y no existe en ninguna página sin ella. */
const RASTROS = ["data-fondo-piedra", "data-bloque-piedra", "Encender el LA", "piedra_", "juntas", "stroke=\"#2C4560\""];
const sinRastros = (h: string) => { for (const r of RASTROS) expect(h, r).not.toContain(r); };

beforeEach(() => { apagada(); estado.items = []; });

describe("sin el interruptor: la salida es la de siempre", () => {
  it("el fondo y el pie, apagados, no agregan nada", () => {
    expect(html(createElement(FondoPiedra, { piedra: false } as never, createElement("p", null, "x")))).toBe("<p>x</p>");
    expect(html(createElement(TexturaPie, { piedra: false }))).toBe("");
    expect(claseDelPie(false)).toBe("footer-global");
  });

  it("404: idéntica al EmptyState de antes", async () => {
    const actual = html(await NotFound());
    const antes = html(
      createElement("main", { className: "mx-auto flex w-full max-w-3xl flex-1 items-center px-4 py-16" },
        createElement(EmptyState, {
          className: "w-full",
          title: "No encontramos la página que busca",
          description: "Es posible que el enlace esté mal escrito o que el producto ya no esté disponible.",
          action: createElement("div", { className: "flex flex-wrap justify-center gap-3" },
            createElement(BotonEnlace, { href: "/catalogo" }, "Ver el catálogo"),
            createElement(BotonEnlace, { href: "/", variant: "secondary" }, "Ir al inicio")),
        })),
    );
    expect(actual).toBe(antes);
    sinRastros(actual);
  });

  it("login y registro: sin fondo, sin LA", async () => {
    for (const pagina of [await IngresarPage(), await RegistroPage()]) {
      const h = html(pagina);
      sinRastros(h);
      expect(h).not.toContain("<svg");
      expect(h.startsWith("<main")).toBe(true);
    }
  });

  it("pie: contenedor de siempre y ni una capa de más", async () => {
    const h = html(await SiteFooter());
    expect(h.startsWith('<div class="footer-global">')).toBe(true);
    expect(h).not.toContain('focusable="false"');
    sinRastros(h);
  });

  it("carrito vacío: el texto de siempre, sin bloque de piedra", () => {
    const h = html(createElement(CarritoClient, { conSesion: false }));
    expect(h).toContain("El carrito está vacío");
    expect(h).toContain("Ver catálogo");
    sinRastros(h);
    expect(h).not.toContain("<svg");
  });

  it("anti-fuga: ninguna salida apagada nombra la piedra", async () => {
    const todo = [
      html(await NotFound()),
      html(await IngresarPage()),
      html(await RegistroPage()),
      html(await SiteFooter()),
      html(createElement(CarritoClient, { conSesion: false })),
    ].join("\n");
    expect(todo).not.toMatch(/piedra|Encender el LA|Visítenos/i);
  });
});

describe("con el interruptor prendido", () => {
  it("login y registro: piedra oscura detrás, LA encendido, encabezado y tarjeta en su lugar", async () => {
    prendida();
    for (const [pagina, clerk] of [[await IngresarPage(), "sign-in"], [await RegistroPage(), "sign-up"]] as const) {
      const h = html(pagina);
      expect(h).toContain("data-fondo-piedra");
      expect(h).toContain("data-encendido");
      expect(h).toContain('aria-hidden="true"');
      expect(h).toContain(`data-clerk="${clerk}"`);
      // La tarjeta de Clerk queda dentro del mismo <main> de siempre.
      expect(h).toMatch(/<main class="mx-auto flex w-full max-w-md[^"]*">[\s\S]*data-clerk=/);
    }
  });

  it("pie: juntas tenues encima, sin eventos y sin texto", async () => {
    prendida();
    const h = html(await SiteFooter());
    expect(h.startsWith('<div class="footer-global relative isolate">')).toBe(true);
    expect(h).toContain('focusable="false"');
    // El resto del pie es el de siempre.
    apagada();
    const base = html(await SiteFooter());
    // Dos capas: las juntas tenues y su brillo que respira.
    expect(h.match(/<svg aria-hidden="true" focusable="false"/g)).toHaveLength(2);
    const sinCapa = h.replace(/<svg aria-hidden="true" focusable="false"[\s\S]*?<\/svg>/g, "").replace("footer-global relative isolate", "footer-global");
    expect(sinCapa).toBe(base);
  });

  it("la textura del pie no pasa de 0,25 de opacidad ni dibuja el LA", () => {
    expect(OPACIDAD_PIE).toBeLessThanOrEqual(0.25);
    const h = html(createElement(TexturaPie, { piedra: true }));
    expect(h).toContain(`opacity="${OPACIDAD_PIE}"`);
    expect(h).not.toContain("<text");
    expect(h).not.toContain("clipPath");
  });

  it("404: bloque de piedra con el LA apagado y el texto de siempre", async () => {
    prendida();
    const h = html(await NotFound());
    expect(h).toContain("data-bloque-piedra");
    expect(h).toContain("No encontramos la página que busca");
    expect(h).toContain("Es posible que el enlace esté mal escrito");
    expect(h).toContain("Ver el catálogo");
    expect(h).toContain('aria-label="Encender el LA"');
    expect(h).toContain('tabindex="0"');
    expect(h).not.toContain("data-encendido");
  });

  it("carrito vacío: bloque de piedra con el texto y el botón de siempre", () => {
    const h = html(createElement(CarritoClient, { conSesion: false, piedra: true }));
    expect(h).toContain("data-bloque-piedra");
    expect(h).toContain("El carrito está vacío");
    expect(h).toContain("Ver catálogo");
    expect(h).toContain('aria-label="Encender el LA"');
  });

  it("el bloque no usa más de un LA tocable y no repite ids entre instancias", () => {
    const dos = html(createElement("div", null, createElement(BloquePiedra, { titulo: "A" }), createElement(BloquePiedra, { titulo: "B" })));
    const ids = [...dos.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("la capa decorativa es sólo dibujo: oculta a los lectores de pantalla y sin foco", () => {
    const h = html(createElement(PiedraDecorativa, { conLA: true, brillo: true }));
    expect(h).toContain('aria-hidden="true"');
    expect(h).not.toContain("tabindex");
    expect(h).not.toContain("role=");
  });
});

describe("rendimiento y registro", () => {
  const dir = __dirname;
  const fuentes = readdirSync(dir).filter((a) => /\.(tsx?|css)$/.test(a) && !/\.test\./.test(a));

  it("ninguna pieza usa cuadros de animación ni observa el scroll", () => {
    for (const f of fuentes) {
      const t = readFileSync(join(dir, f), "utf8");
      expect(t, f).not.toMatch(/requestAnimationFrame|IntersectionObserver|setInterval/);
    }
  });

  it("reutilizan el parpadeo del hero: ni keyframes de arranque ni lógica propia de encendido", () => {
    const css = readFileSync(join(dir, "piedra.module.css"), "utf8");
    expect(css).not.toContain("@keyframes arranque");
    const comun = readFileSync(join(dir, "escena-comun.tsx"), "utf8");
    expect(comun).toContain("HeroPiedra.module.css");
    expect(readFileSync(join(dir, "BloquePiedra.tsx"), "utf8")).toContain("enlazarEncendido");
  });

  it("el brillo lento se apaga con movimiento reducido", () => {
    const css = readFileSync(join(dir, "piedra.module.css"), "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.brillo\s*\{\s*animation: none/);
  });

  it("no nombran a ninguna empresa", () => {
    for (const f of fuentes) expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/central/i);
  });
});
