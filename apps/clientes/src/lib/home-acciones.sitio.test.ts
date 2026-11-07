import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * El editor in-place escribe en el espacio de claves del sitio donde corre (change
 * `marca-por-dominio`, S3): editar el anuncio en un sitio propio no toca la clave del principal.
 */
let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ esAdmin: async () => true }));
vi.mock("@/lib/sitio-datos", () => ({
  leerDestinosExtra: async () => [{ etiqueta: "tienda-b", url: "https://tienda-b.example", marca: { nombre: "Tienda B" } }],
}));
vi.mock("@/lib/shop-media", () => ({ getShopMediaR2: vi.fn(), homeImagenKey: vi.fn(), urlPublicaHome: vi.fn() }));
vi.mock("@/lib/busqueda-v2/motor-servidor", () => ({ buscarEnShop: vi.fn() }));
vi.mock("@/lib/catalog", () => ({ getProductosPorSkus: vi.fn() }));
vi.mock("@/lib/sucursales-repo", () => ({ leerSucursalesYZonas: vi.fn() }));
vi.mock("@/lib/sucursales-datos", () => ({ sucursalesCacheadas: vi.fn() }));

import { guardarSeccion, restablecerSeccion } from "./home-acciones";

const claves = () => grabadora.consultas.flatMap((c) => c.params).filter((p): p is string => typeof p === "string");

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-editor");
  grabadora = dbGrabadora(() => [[new Date()]]);
});
afterEach(() => vi.unstubAllEnvs());

describe("el editor escribe en el espacio del sitio actual", () => {
  it("en un sitio propio, el anuncio va a sitio:<etiqueta>:anuncio y nunca a la clave del principal", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
    const r = await guardarSeccion("anuncio", { texto: "Hola" });
    expect(r.ok).toBe(true);
    expect(claves()).toContain("sitio:tienda-b:anuncio");
    expect(claves()).not.toContain("anuncio");
  });

  it("restablecer en un sitio propio borra sólo su fila", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
    await restablecerSeccion("anuncio");
    expect(claves()).toContain("sitio:tienda-b:anuncio");
    expect(claves()).not.toContain("anuncio");
  });

  it("en el principal escribe la clave de siempre", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cliente.example");
    await guardarSeccion("anuncio", { texto: "Hola" });
    expect(claves()).toContain("anuncio");
    expect(claves().some((k) => k.startsWith("sitio:"))).toBe(false);
  });
});
