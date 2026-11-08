import { beforeEach, describe, expect, it, vi } from "vitest";
import { MARCA_POR_DEFECTO } from "./marca-base";

// Prueba la lectura real: el mock global de setup-flags.ts devuelve la marca de Central.
vi.unmock("@/lib/marca");

const { limitMock, cacheLifeMock, cacheTagMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  cacheLifeMock: vi.fn(),
  cacheTagMock: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: limitMock }) }) }) }),
}));
vi.mock("next/cache", () => ({ cacheLife: cacheLifeMock, cacheTag: cacheTagMock }));

import { getMarca } from "./marca";

describe("getMarca (caché de la marca)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
    vi.stubEnv("SHOP_MEDIA_HOSTS", "media.example");
    vi.stubEnv("NEXT_PUBLIC_SHOP_MARCA_NOMBRE", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("SHOP_SITIO", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("con la base: tag marca y vida del perfil marca", async () => {
    limitMock.mockResolvedValue([{ shopMarca: { base: "generica", nombre: "Tienda Uno" } }]);
    const m = await getMarca();
    expect(m.nombre).toBe("Tienda Uno");
    expect(cacheTagMock).toHaveBeenCalledWith("marca");
    expect(cacheLifeMock).toHaveBeenCalledWith("marca");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("degradado");
  });

  it("marca vacía: la de Central, exacta", async () => {
    limitMock.mockResolvedValue([{ shopMarca: {} }]);
    expect(await getMarca()).toEqual(MARCA_POR_DEFECTO);
  });

  it("sin fila del tenant: la de Central", async () => {
    limitMock.mockResolvedValue([]);
    expect(await getMarca()).toEqual(MARCA_POR_DEFECTO);
  });

  it("la columna todavía no existe (o la base cae): no lanza y usa el perfil degradado", async () => {
    limitMock.mockRejectedValue(new Error('column "shop_marca" does not exist'));
    expect(await getMarca()).toEqual(MARCA_POR_DEFECTO);
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("marca");
  });

  it("base caída con la variable del nombre: sólo el nombre, nada de Central", async () => {
    vi.stubEnv("NEXT_PUBLIC_SHOP_MARCA_NOMBRE", "Tienda Uno");
    limitMock.mockRejectedValue(new Error("sin conexión"));
    const m = await getMarca();
    expect(m.nombre).toBe("Tienda Uno");
    expect(JSON.stringify(m).replace("recursosCentral", "")).not.toMatch(/central|iguaz/i);
  });

  it("sin SHOP_TENANT_ID tampoco lanza", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "");
    expect(await getMarca()).toEqual(MARCA_POR_DEFECTO);
  });

  describe("por sitio (shop_destinos_extra)", () => {
    const EXTRAS = [
      { etiqueta: "alias", url: "https://alias.cliente.example" },
      { etiqueta: "tienda-b", url: "https://tienda-b.example", marca: { nombre: "Tienda B", faviconUrl: "https://media.example/f.png" } },
    ];
    const PRINCIPAL = { shopMarca: { base: "generica", nombre: "Principal" } };

    it("el sitio propio usa la marca de su destino y no la del principal", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
      limitMock.mockResolvedValueOnce([PRINCIPAL]).mockResolvedValueOnce([{ shopDestinosExtra: EXTRAS }]);
      const m = await getMarca();
      expect(m.nombre).toBe("Tienda B");
      expect(m.faviconUrl).toBe("https://media.example/f.png");
      expect(m.recursosCentral).toBe(false);
    });

    it("sitio propio con marca parcial: base genérica, sin nada de Central", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
      vi.stubEnv("NEXT_PUBLIC_SHOP_MARCA_NOMBRE", "Tienda B");
      limitMock
        .mockResolvedValueOnce([{ shopMarca: {} }])
        .mockResolvedValueOnce([{ shopDestinosExtra: [{ etiqueta: "tienda-b", url: "https://tienda-b.example", marca: { descripcion: "Luces" } }] }]);
      const m = await getMarca();
      expect(m.base).toBe("generica");
      expect(m.recursosCentral).toBe(false);
      expect(m.nombre).toBe("Tienda B");
      expect(m.lema).toBe("");
    });

    it("un alias usa la marca del principal", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://alias.cliente.example");
      limitMock.mockResolvedValueOnce([PRINCIPAL]).mockResolvedValueOnce([{ shopDestinosExtra: EXTRAS }]);
      expect((await getMarca()).nombre).toBe("Principal");
    });

    it("un sitio desconocido o sin la variable se comporta como hoy", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://otro.example");
      limitMock.mockResolvedValueOnce([PRINCIPAL]).mockResolvedValueOnce([{ shopDestinosExtra: EXTRAS }]);
      expect((await getMarca()).nombre).toBe("Principal");
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
      limitMock.mockClear();
      limitMock.mockResolvedValueOnce([PRINCIPAL]);
      expect((await getMarca()).nombre).toBe("Principal");
      expect(limitMock).toHaveBeenCalledTimes(1);
    });

    it("dos sitios del mismo proceso no se contaminan", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
      limitMock.mockResolvedValueOnce([PRINCIPAL]).mockResolvedValueOnce([{ shopDestinosExtra: EXTRAS }]);
      const b = await getMarca();
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cliente.example");
      limitMock.mockResolvedValueOnce([PRINCIPAL]).mockResolvedValueOnce([{ shopDestinosExtra: EXTRAS }]);
      const a = await getMarca();
      expect(b.nombre).toBe("Tienda B");
      expect(a.nombre).toBe("Principal");
    });

    it("sin permiso sobre shop_destinos_extra: marca de entorno degradada, nunca Central ni el principal", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
      vi.stubEnv("NEXT_PUBLIC_SHOP_MARCA_NOMBRE", "Tienda B");
      limitMock.mockResolvedValueOnce([PRINCIPAL]).mockRejectedValueOnce(new Error("permission denied for column shop_destinos_extra"));
      const m = await getMarca();
      expect(m.nombre).toBe("Tienda B");
      expect(m.recursosCentral).toBe(false);
      expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
      expect(cacheLifeMock).not.toHaveBeenCalledWith("marca");
    });

    it("el tag marca cubre a todos los sitios", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
      limitMock.mockResolvedValueOnce([PRINCIPAL]).mockResolvedValueOnce([{ shopDestinosExtra: EXTRAS }]);
      await getMarca();
      expect(cacheTagMock).toHaveBeenCalledWith("marca");
    });
  });
});
