import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

let grabadora = dbGrabadora();
let admin = true;
const { updateTag } = vi.hoisted(() => ({ updateTag: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag }));
vi.mock("@/lib/auth", () => ({ esAdmin: async () => admin }));
vi.mock("@/lib/sitio-datos", () => ({
  leerDestinosExtra: async () => [{ etiqueta: "tienda-b", url: "https://tienda-b.example", marca: { nombre: "Tienda B" } }],
}));
vi.mock("@/lib/shop-media", () => ({ getShopMediaR2: vi.fn(), homeImagenKey: vi.fn(), urlPublicaHome: vi.fn() }));
vi.mock("@/lib/busqueda-v2/motor-servidor", () => ({ buscarEnShop: vi.fn() }));
vi.mock("@/lib/catalog", () => ({ getProductosPorSkus: vi.fn() }));
vi.mock("@/lib/sucursales-repo", () => ({ leerSucursalesYZonas: vi.fn() }));
vi.mock("@/lib/sucursales-datos", () => ({ sucursalesCacheadas: vi.fn() }));

import { guardarDecoracion } from "./home-acciones";

const claves = () => grabadora.consultas.flatMap((c) => c.params).filter((p): p is string => typeof p === "string");

beforeEach(() => {
  vi.clearAllMocks();
  admin = true;
  vi.stubEnv("SHOP_TENANT_ID", "tenant-deco");
  vi.spyOn(console, "error").mockImplementation(() => {});
  grabadora = dbGrabadora(() => [[new Date()]]);
});
afterEach(() => vi.unstubAllEnvs());

describe("guardarDecoracion", () => {
  it("un admin guarda { piedra } en la clave `decoracion` del sitio y revalida el tag home", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
    const r = await guardarDecoracion({ piedra: true });
    expect(r.ok).toBe(true);
    expect(claves()).toContain("sitio:tienda-b:decoracion");
    expect(claves()).not.toContain("decoracion");
    expect(updateTag).toHaveBeenCalledWith("home");
  });

  it("en el principal escribe la clave sin prefijo", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cliente.example");
    await guardarDecoracion({ piedra: false });
    expect(claves()).toContain("decoracion");
  });

  it("sin permiso no escribe nada", async () => {
    admin = false;
    const r = await guardarDecoracion({ piedra: true });
    expect(r).toEqual({ ok: false, errores: [expect.stringContaining("No tiene permisos")] });
    expect(grabadora.consultas).toHaveLength(0);
  });

  it("un payload inválido se rechaza sin escribir", async () => {
    const r = await guardarDecoracion({ piedra: "si" });
    expect(r.ok).toBe(false);
    expect(grabadora.consultas).toHaveLength(0);
  });
});
