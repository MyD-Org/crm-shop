import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

const { busquedasFrecuentes, cacheLifeMock } = vi.hoisted(() => ({
  busquedasFrecuentes: vi.fn(),
  cacheLifeMock: vi.fn(),
}));
vi.mock("@/lib/busqueda-inteligente/cache", () => ({ busquedasFrecuentes }));
vi.mock("@/lib/catalog", () => ({
  getArbolCategorias: async () => [{ id: "c1", parentId: null, nombre: "Reflectores", orden: 1 }],
}));
vi.mock("next/cache", () => ({ cacheLife: cacheLifeMock }));
vi.mock("next/server", async (importar) => ({
  ...(await importar<typeof import("next/server")>()),
  connection: async () => {},
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("GET /api/shop/busquedas-frecuentes", () => {
  it("flag apagado ⇒ 404 sin leer la caché", async () => {
    const res = await GET();
    expect(res.status).toBe(404);
    expect(busquedasFrecuentes).not.toHaveBeenCalled();
  });

  it("prendido ⇒ las frecuentes del tenant, cacheadas una hora", async () => {
    setFlag("busqueda-ia", true);
    busquedasFrecuentes.mockResolvedValue(["luz calida", "juan perez", "reflector exterior", "compren aca"]);
    const res = await GET();
    expect(res.status).toBe(200);
    // Sólo las hechas de vocabulario conocido: el texto libre no se publica.
    expect(await res.json()).toEqual({ busquedas: ["luz calida", "reflector exterior"] });
    expect(busquedasFrecuentes).toHaveBeenCalledWith("tenant-test", 30);
    expect(cacheLifeMock).toHaveBeenCalledWith("busquedas");
  });

  it("sin frecuentes (o caché caída) ⇒ lista vacía guardada sólo unos minutos", async () => {
    setFlag("busqueda-ia", true);
    busquedasFrecuentes.mockResolvedValue([]);
    const res = await GET();
    expect(await res.json()).toEqual({ busquedas: [] });
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
  });
});
