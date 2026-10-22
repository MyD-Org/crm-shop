import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  publicadas: vi.fn(),
  ids: vi.fn(async () => ["p1"]),
  institucionales: vi.fn(async () => []),
}));
vi.mock("@/lib/marcas/marcas-datos", () => ({ getPaginasMarcaPublicadas: m.publicadas }));
vi.mock("@/lib/catalogo-publico", () => ({ idsProductosPublicos: m.ids }));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: true, variantes: false }) }));
vi.mock("@/lib/institucional/datos", () => ({ getPaginasPublicadas: m.institucionales }));

import sitemap from "./sitemap";

const pagina = (slug: string) => ({
  slug,
  nombre: slug,
  nivel: "oficial",
  publicada: true,
  orden: 1,
  marcasCatalogo: [slug],
  bajada: "",
  bloques: {},
  visibilidad: {},
});

/** Páginas de marca en el sitemap: cada publicada. No hay índice `/marcas` (se sacó: no lista todas). */
describe("sitemap y páginas de marca", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda.example"));

  it("suma cada página publicada y nunca /marcas", async () => {
    m.publicadas.mockResolvedValue([pagina("acme")]);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain("https://tienda.example/marcas/acme");
    expect(urls).not.toContain("https://tienda.example/marcas");
  });
});
