import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/catalogo-publico", () => ({ idsProductosPublicos: vi.fn(async () => ["1"]) }));
vi.mock("@/lib/flags-publicos", () => ({
  flagsPublicos: vi.fn(async () => ({ soloVisibles: false, variantes: false })),
}));
vi.mock("@/lib/institucional/datos", () => ({ getPaginasPublicadas: vi.fn(async () => []) }));
vi.mock("@/lib/marcas/marcas-datos", () => ({ getPaginasMarcaPublicadas: vi.fn(async () => []) }));

import sitemap from "./sitemap";

describe("sitemap", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("en el sitio secundario (CANONICAL distinta de SITE) sale vacío", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cliente.example");
    vi.stubEnv("NEXT_PUBLIC_CANONICAL_URL", "https://tienda-b.example");
    expect(await sitemap()).toEqual([]);
  });

  it("sin CANONICAL lista solo URLs bajo SITE_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cliente.example");
    vi.stubEnv("NEXT_PUBLIC_CANONICAL_URL", "");
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith("https://cliente.example"))).toBe(true);
    expect(urls).toContain("https://cliente.example/producto/1");
  });

  it("principal (CANONICAL igual a SITE) idéntico al caso sin CANONICAL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
    vi.stubEnv("NEXT_PUBLIC_CANONICAL_URL", "https://tienda-b.example/");
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.every((u) => u.startsWith("https://tienda-b.example"))).toBe(true);
  });
});
