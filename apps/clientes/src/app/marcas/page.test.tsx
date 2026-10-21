import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  publicadas: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  ids: vi.fn(async () => ["p1"]),
  institucionales: vi.fn(async () => []),
}));
vi.mock("@/lib/marcas/marcas-datos", () => ({ getPaginasMarcaPublicadas: m.publicadas }));
vi.mock("next/navigation", () => ({ notFound: m.notFound }));
vi.mock("@/lib/marca", async () => ({
  getMarca: async () => (await import("@/lib/marca-base")).MARCA_POR_DEFECTO,
}));
vi.mock("@/lib/catalogo-publico", () => ({ idsProductosPublicos: m.ids }));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: true, variantes: false }) }));
vi.mock("@/lib/institucional/datos", () => ({ getPaginasPublicadas: m.institucionales }));

import MarcasPage from "./page";
import sitemap from "../sitemap";

const pagina = (slug: string, nivel: "oficial" | "marca") => ({
  slug,
  nombre: slug.toUpperCase(),
  nivel,
  publicada: true,
  orden: 1,
  marcasCatalogo: [slug],
  bajada: `Bajada ${slug}`,
  bloques: {},
  visibilidad: {},
});

/** Ejecuta el hijo asíncrono del Suspense. */
async function contenido() {
  const raiz = MarcasPage() as unknown as { props: { children: { type: () => Promise<unknown> } } };
  return raiz.props.children.type();
}

describe("/marcas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sin páginas publicadas: 404", async () => {
    m.publicadas.mockResolvedValue([]);
    await expect(contenido()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lista las publicadas, la oficial primero con su bajada", async () => {
    m.publicadas.mockResolvedValue([pagina("acme", "oficial"), pagina("macro", "marca")]);
    const html = renderToStaticMarkup(createElement("div", null, (await contenido()) as never));
    expect(html.indexOf("/marcas/acme")).toBeLessThan(html.indexOf("/marcas/macro"));
    expect(html).toContain("Tienda oficial");
    expect(html).toContain("Bajada acme");
  });
});

describe("sitemap", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda.example"));

  it("suma /marcas y cada página publicada", async () => {
    m.publicadas.mockResolvedValue([pagina("acme", "oficial")]);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain("https://tienda.example/marcas");
    expect(urls).toContain("https://tienda.example/marcas/acme");
  });

  it("sin páginas de marca, sin /marcas", async () => {
    m.publicadas.mockResolvedValue([]);
    expect((await sitemap()).map((e) => e.url)).not.toContain("https://tienda.example/marcas");
  });
});
