import { beforeEach, describe, expect, it, vi } from "vitest";

const { esAdminMock, guardarMock, borrarMock, revalidateMock, r2Mock } = vi.hoisted(() => ({
  esAdminMock: vi.fn(),
  guardarMock: vi.fn(),
  borrarMock: vi.fn(),
  revalidateMock: vi.fn(),
  r2Mock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  esAdmin: esAdminMock,
}));

vi.mock("@/lib/home-guardar", () => ({
  guardarSeccionHome: guardarMock,
  borrarSeccionHome: borrarMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidateMock,
}));

vi.mock("@/lib/shop-media", () => ({
  getShopMediaR2: r2Mock,
  homeImagenKey: vi.fn(() => "home/central-led/fake-1600.webp"),
  urlPublicaHome: vi.fn((k: string) => `https://media.plataforma.example/${k}`),
}));

vi.mock("@/lib/tenant", () => ({
  shopTenantId: () => "central-led",
}));

import { firmarSubidaImagenHome, guardarSeccion, restablecerSeccion } from "./home-acciones";

describe("guardarSeccion / restablecerSeccion / firmarSubidaImagenHome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    esAdminMock.mockResolvedValue(true);
    guardarMock.mockResolvedValue({ updatedAt: new Date("2026-09-22T00:00:00Z") });
    borrarMock.mockResolvedValue(undefined);
    r2Mock.mockReturnValue(null);
  });

  it("No-admin intenta guardar: no toca DB ni revalida", async () => {
    esAdminMock.mockResolvedValue(false);

    const r = await guardarSeccion("anuncio", { texto: "Hola" });

    expect(r).toEqual({ ok: false, errores: ["No tiene permisos para editar la página de inicio."] });
    expect(guardarMock).not.toHaveBeenCalled();
    expect(borrarMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("No-admin intenta restablecer", async () => {
    esAdminMock.mockResolvedValue(false);

    const r = await restablecerSeccion("hero");

    expect(r.ok).toBe(false);
    expect(borrarMock).not.toHaveBeenCalled();
  });

  it("No-admin intenta firmar una subida: no consulta R2", async () => {
    esAdminMock.mockResolvedValue(false);

    const r = await firmarSubidaImagenHome({ bytes: 1000 });

    expect(r.ok).toBe(false);
    expect(r2Mock).not.toHaveBeenCalled();
  });

  it("Admin guarda una sección válida", async () => {
    const r = await guardarSeccion("anuncio", { texto: "Envíos a todo el país" });

    expect(guardarMock).toHaveBeenCalledWith("anuncio", { texto: "Envíos a todo el país" });
    expect(r).toEqual({ ok: true, updatedAt: "2026-09-22T00:00:00.000Z" });
  });

  it("Admin guarda un payload inválido", async () => {
    const r = await guardarSeccion("hero", { titulo: "" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.length).toBeGreaterThan(0);
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("Sección desconocida", async () => {
    const r = await guardarSeccion("footer", { texto: "x" });

    expect(r).toEqual({ ok: false, errores: ["La sección indicada no existe."] });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("navBadge null apaga el badge (D4/R3): guarda, no borra", async () => {
    const r = await guardarSeccion("navBadge", null);

    expect(guardarMock).toHaveBeenCalledWith("navBadge", null);
    expect(borrarMock).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, updatedAt: "2026-09-22T00:00:00.000Z" });
  });

  it("Error de base de datos no se propaga como excepción", async () => {
    guardarMock.mockRejectedValue(new Error("connection refused"));

    const r = await guardarSeccion("anuncio", { texto: "x" });

    expect(r).toEqual({ ok: false, errores: ["No se pudo guardar la sección. Inténtelo de nuevo."] });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("Restablecer una sección con fila guardada", async () => {
    const r = await restablecerSeccion("marquee");

    expect(borrarMock).toHaveBeenCalledWith("marquee");
    expect(r).toEqual({ ok: true, updatedAt: null });
  });

  it("Restablecer key desconocida", async () => {
    const r = await restablecerSeccion("zzz");

    expect(r).toEqual({ ok: false, errores: ["La sección indicada no existe."] });
    expect(borrarMock).not.toHaveBeenCalled();
  });

  it("Guardado exitoso revalida exactamente una vez con (\"/\", \"layout\")", async () => {
    await guardarSeccion("anuncio", { texto: "x" });

    expect(revalidateMock).toHaveBeenCalledTimes(1);
    expect(revalidateMock).toHaveBeenCalledWith("/", "layout");
  });

  it("Restablecer exitoso revalida", async () => {
    await restablecerSeccion("hero");

    expect(revalidateMock).toHaveBeenCalledTimes(1);
    expect(revalidateMock).toHaveBeenCalledWith("/", "layout");
  });

  it("Validación fallida no revalida", async () => {
    await guardarSeccion("hero", {});

    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("firma sin R2 configurado", async () => {
    r2Mock.mockReturnValue(null);

    const r = await firmarSubidaImagenHome({ bytes: 100 });

    expect(r).toEqual({
      ok: false,
      errores: ["El almacenamiento de imágenes no está configurado. Avise al administrador."],
    });
  });

  describe("firmarSubidaImagenHome", () => {
    it("firma exitosa: key correcta, presignPut con los parámetros esperados y urlPublica", async () => {
      const presignMock = vi.fn().mockResolvedValue({ url: "https://r2.example/x?sig", headers: { "content-type": "image/webp" } });
      r2Mock.mockReturnValue({ presignPut: presignMock });

      const r = await firmarSubidaImagenHome({ bytes: 100000 });

      expect(presignMock).toHaveBeenCalledWith("home/central-led/fake-1600.webp", {
        contentType: "image/webp",
        contentLength: 100000,
        ttlSeconds: 600,
      });
      expect(r).toEqual({
        ok: true,
        key: "home/central-led/fake-1600.webp",
        url: "https://r2.example/x?sig",
        headers: { "content-type": "image/webp" },
        urlPublica: "https://media.plataforma.example/home/central-led/fake-1600.webp",
      });
    });

    it.each([0, -1, 1.5, "abc", 5 * 1024 * 1024 + 1])("tamaño inválido (%s) ⇒ error y no firma", async (bytes) => {
      const presignMock = vi.fn();
      r2Mock.mockReturnValue({ presignPut: presignMock });

      const r = await firmarSubidaImagenHome({ bytes: bytes as unknown as number });

      expect(r).toEqual({ ok: false, errores: ["La imagen supera el tamaño permitido (5 MB)."] });
      expect(presignMock).not.toHaveBeenCalled();
    });

    it("sin tenant ⇒ mensaje de almacenamiento no configurado (no propaga el Error de shopTenantId)", async () => {
      vi.doMock("@/lib/tenant", () => ({
        shopTenantId: () => {
          throw new Error("Falta SHOP_TENANT_ID en el entorno.");
        },
      }));
      vi.resetModules();
      const { firmarSubidaImagenHome: firmarSinTenant } = await import("./home-acciones");
      r2Mock.mockReturnValue({ presignPut: vi.fn() });

      const r = await firmarSinTenant({ bytes: 100 });

      expect(r).toEqual({
        ok: false,
        errores: ["El almacenamiento de imágenes no está configurado. Avise al administrador."],
      });
      vi.doUnmock("@/lib/tenant");
      vi.resetModules();
    });

    it("presignPut rechaza ⇒ error de firma genérico", async () => {
      r2Mock.mockReturnValue({ presignPut: vi.fn().mockRejectedValue(new Error("boom")) });

      const r = await firmarSubidaImagenHome({ bytes: 100 });

      expect(r).toEqual({ ok: false, errores: ["No se pudo preparar la subida. Inténtelo de nuevo."] });
    });
  });
});
