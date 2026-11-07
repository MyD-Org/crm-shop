import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * Interruptor de la textura de piedra: fila `decoracion` de home_content, por sitio. Se lee con una
 * función cacheada con el tag `home` y la clave del sitio como argumento; se escribe por el chokepoint
 * (`home-guardar`), que agrega el prefijo del sitio. Dominios de ejemplo (.example).
 */
const { leerMock, cacheTag } = vi.hoisted(() => ({ leerMock: vi.fn(), cacheTag: vi.fn() }));
let grabadora = dbGrabadora();

vi.mock("@/db", () => ({ getDb: () => grabadora.db }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag, updateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ esAdmin: async () => true }));
vi.mock("@/lib/marca", () => ({ getMarca: async () => ({ base: "central", nombre: "Tienda" }) }));
vi.mock("@/lib/sitio-datos", () => ({
  leerDestinosExtra: async () => [{ etiqueta: "tienda-b", url: "https://tienda-b.example", marca: { nombre: "Tienda B" } }],
}));
vi.mock("@/lib/home-guardar", async (original) => ({ ...(await original<object>()), leerSeccionHome: leerMock }));
vi.mock("@/lib/shop-media", () => ({ getShopMediaR2: vi.fn(), homeImagenKey: vi.fn(), urlPublicaHome: vi.fn() }));
vi.mock("@/lib/busqueda-v2/motor-servidor", () => ({ buscarEnShop: vi.fn() }));
vi.mock("@/lib/catalog", () => ({ getProductosPorSkus: vi.fn() }));
vi.mock("@/lib/sucursales-datos", () => ({ sucursalesCacheadas: vi.fn() }));
vi.mock("@/lib/sucursales-repo", () => ({ leerSucursalesYZonas: vi.fn() }));

import { getDecoracion } from "./home-datos";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SHOP_TENANT_ID", "tenant-deco");
  vi.spyOn(console, "error").mockImplementation(() => {});
  grabadora = dbGrabadora(() => [[new Date()]]);
});
afterEach(() => vi.unstubAllEnvs());

describe("getDecoracion", () => {
  it("sin fila: la piedra está apagada", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cliente.example");
    leerMock.mockResolvedValue(undefined);
    expect(await getDecoracion()).toEqual({ piedra: false });
  });

  it("con la fila prendida: piedra true, con el tag `home` y la clave `decoracion`", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://piedra.example");
    leerMock.mockResolvedValue({ piedra: true });
    expect(await getDecoracion()).toEqual({ piedra: true });
    expect(cacheTag).toHaveBeenCalledWith("home");
    expect(leerMock.mock.calls[0][0]).toBe("decoracion");
  });

  it("un payload inválido es falso", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://invalido.example");
    leerMock.mockResolvedValue({ piedra: "true" });
    expect(await getDecoracion()).toEqual({ piedra: false });
  });

  it("si la lectura falla, apagada (nunca rompe la página)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://falla.example");
    leerMock.mockRejectedValue(new Error("db caída"));
    expect(await getDecoracion()).toEqual({ piedra: false });
  });

  it("recibe la clave del sitio como argumento: dos sitios no comparten resultado", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://a.example");
    leerMock.mockResolvedValue({ piedra: true });
    await getDecoracion();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://b.example");
    await getDecoracion();
    expect(leerMock.mock.calls.map((c) => c[1])).toEqual(["https://a.example|", "https://b.example|"]);
  });
});
