import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/tema-contrato.json";

// Prueba la lectura real: el mock global de setup-flags.ts devuelve el tema de Central.
vi.unmock("@/lib/tema-tenant-datos");

const { limitMock, cacheLifeMock, cacheTagMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  cacheLifeMock: vi.fn(),
  cacheTagMock: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: limitMock }) }) }) }),
}));
vi.mock("next/cache", () => ({ cacheLife: cacheLifeMock, cacheTag: cacheTagMock }));

import { getTemaTenant } from "./tema-tenant-datos";

describe("getTemaTenant (caché del tema)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("SHOP_SITIO", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("con paleta propia: la devuelve, con el tag marca y la vida del perfil marca", async () => {
    limitMock.mockResolvedValue([{ shopTema: { colores: fixture.paletas["calido-azul"] } }]);
    const t = await getTemaTenant();
    expect(t.colores).toEqual(fixture.paletas["calido-azul"]);
    expect(cacheTagMock).toHaveBeenCalledWith("marca");
    expect(cacheLifeMock).toHaveBeenCalledWith("marca");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("degradado");
  });

  it("tema vacío o sin fila: el de Central, sin paleta propia", async () => {
    limitMock.mockResolvedValue([{ shopTema: {} }]);
    expect(await getTemaTenant()).toEqual({ base: "calido-azul", colores: null });
    limitMock.mockResolvedValue([]);
    expect(await getTemaTenant()).toEqual({ base: "calido-azul", colores: null });
  });

  it("la columna todavía no existe (o la base cae): no lanza y usa el perfil degradado", async () => {
    limitMock.mockRejectedValue(new Error('column "shop_tema" does not exist'));
    expect(await getTemaTenant()).toEqual({ base: "calido-azul", colores: null });
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("marca");
  });

  it("sin SHOP_TENANT_ID tampoco lanza", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "");
    limitMock.mockResolvedValue([]);
    expect(await getTemaTenant()).toEqual({ base: "calido-azul", colores: null });
  });

  describe("por sitio (shop_destinos_extra)", () => {
    const PALETA = fixture.paletas["calido-azul"];
    const EXTRAS = [
      { etiqueta: "alias", url: "https://alias.cliente.example" },
      { etiqueta: "tienda-b", url: "https://tienda-b.example", marca: { nombre: "Tienda B" }, tema: { base: "calido" } },
      { etiqueta: "tienda-c", url: "https://tienda-c.example", marca: { nombre: "Tienda C" } },
    ];
    const PRINCIPAL = { shopTema: { colores: PALETA } };

    it("el sitio propio usa el tema de su destino y no la paleta del principal", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
      limitMock.mockResolvedValueOnce([PRINCIPAL]).mockResolvedValueOnce([{ shopDestinosExtra: EXTRAS }]);
      expect(await getTemaTenant()).toEqual({ base: "calido", colores: null });
    });

    it("un sitio propio sin tema no hereda la paleta del principal", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-c.example");
      limitMock.mockResolvedValueOnce([PRINCIPAL]).mockResolvedValueOnce([{ shopDestinosExtra: EXTRAS }]);
      expect((await getTemaTenant()).colores).toBeNull();
    });

    it("un alias o el principal usan shop_tema", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://alias.cliente.example");
      limitMock.mockResolvedValueOnce([PRINCIPAL]).mockResolvedValueOnce([{ shopDestinosExtra: EXTRAS }]);
      expect((await getTemaTenant()).colores).toEqual(PALETA);
    });

    it("sin permiso sobre shop_destinos_extra: tema por defecto con perfil degradado", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
      limitMock.mockResolvedValueOnce([PRINCIPAL]).mockRejectedValueOnce(new Error("permission denied"));
      expect(await getTemaTenant()).toEqual({ base: "calido-azul", colores: null });
      expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    });
  });
});
