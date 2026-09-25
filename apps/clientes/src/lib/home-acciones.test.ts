import { beforeEach, describe, expect, it, vi } from "vitest";

const { esAdminMock, guardarMock, borrarMock, leerMock, revalidateMock, r2Mock, getCatalogoMock } = vi.hoisted(() => ({
  esAdminMock: vi.fn(),
  guardarMock: vi.fn(),
  borrarMock: vi.fn(),
  leerMock: vi.fn(),
  revalidateMock: vi.fn(),
  r2Mock: vi.fn(),
  getCatalogoMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  esAdmin: esAdminMock,
}));

vi.mock("@/lib/home-guardar", () => ({
  guardarSeccionHome: guardarMock,
  borrarSeccionHome: borrarMock,
  leerSeccionHome: leerMock,
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

vi.mock("@/lib/catalog", () => ({
  getCatalogo: getCatalogoMock,
}));

import {
  buscarProductosHome,
  cambiarVisibilidadSeccion,
  firmarSubidaImagenHome,
  guardarDatosLegales,
  guardarSeccion,
  leerSeccionParaEditar,
  restablecerSeccion,
} from "./home-acciones";
import { DEFAULTS_HOME } from "@/data/home-defaults";
import { REGISTRO, infracciones } from "@/test/registro-usted";

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

  describe("buscarProductosHome (rebanada D)", () => {
    it("No-admin: no busca en el catálogo", async () => {
      esAdminMock.mockResolvedValue(false);

      const r = await buscarProductosHome("lampara");

      expect(r).toEqual({ ok: false, errores: ["No tiene permisos para editar la página de inicio."] });
      expect(getCatalogoMock).not.toHaveBeenCalled();
    });

    it("Admin: devuelve hasta 20 resultados del catálogo con sku, nombre y foto", async () => {
      getCatalogoMock.mockResolvedValue([
        {
          id: "1",
          name: "Lámpara colgante",
          sku: "ADM-D8-BCO-CO",
          price: 1000,
          stock: "in",
          images: [{ url: "/a.webp", w: 800 }],
        },
        { id: "2", name: "Lámpara de mesa", sku: "ADM-D9-BCO-CO", price: 900, stock: "in", images: [] },
      ]);

      const r = await buscarProductosHome("lampara");

      expect(getCatalogoMock).toHaveBeenCalledWith({ busqueda: "lampara", limit: 20 });
      expect(r).toEqual({
        ok: true,
        productos: [
          { sku: "ADM-D8-BCO-CO", nombre: "Lámpara colgante", foto: "/a.webp" },
          { sku: "ADM-D9-BCO-CO", nombre: "Lámpara de mesa", foto: undefined },
        ],
      });
    });

    it("Query vacía: no llama al catálogo y devuelve lista vacía", async () => {
      const r = await buscarProductosHome("   ");

      expect(getCatalogoMock).not.toHaveBeenCalled();
      expect(r).toEqual({ ok: true, productos: [] });
    });

    it("Productos sin sku se descartan (no se pueden curar)", async () => {
      getCatalogoMock.mockResolvedValue([{ id: "1", name: "Sin código", price: 1000, stock: "in" }]);

      const r = await buscarProductosHome("x");

      expect(r).toEqual({ ok: true, productos: [] });
    });

    it("Error del catálogo no se propaga como excepción", async () => {
      getCatalogoMock.mockRejectedValue(new Error("db down"));

      const r = await buscarProductosHome("x");

      expect(r).toEqual({ ok: false, errores: ["No se pudo buscar productos. Inténtelo de nuevo."] });
    });
  });
});

describe("cambiarVisibilidadSeccion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    esAdminMock.mockResolvedValue(true);
    guardarMock.mockResolvedValue({ updatedAt: new Date("2026-09-22T00:00:00Z") });
    leerMock.mockResolvedValue(undefined);
  });

  it("No-admin no puede ocultar", async () => {
    esAdminMock.mockResolvedValue(false);

    const r = await cambiarVisibilidadSeccion("hero", "nunca");

    expect(r.ok).toBe(false);
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("rechaza una sección desconocida", async () => {
    const r = await cambiarVisibilidadSeccion("inexistente", "nunca");

    expect(r).toEqual({ ok: false, errores: ["La sección indicada no existe."] });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("rechaza una visibilidad desconocida", async () => {
    const r = await cambiarVisibilidadSeccion("hero", "a veces");

    expect(r).toEqual({ ok: false, errores: ["Indique dónde se muestra la sección."] });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("guarda la visibilidad en la fila `ocultas` sin tocar el contenido de la sección", async () => {
    leerMock.mockResolvedValue({ marquee: "nunca" });

    const r = await cambiarVisibilidadSeccion("hero", "mobile");

    expect(r.ok).toBe(true);
    expect(guardarMock).toHaveBeenCalledWith("ocultas", { hero: "mobile", marquee: "nunca" });
    expect(guardarMock).not.toHaveBeenCalledWith("hero", expect.anything());
    expect(revalidateMock).toHaveBeenCalledWith("/", "layout");
  });

  it("convierte el formato viejo (array de ocultas) al guardar", async () => {
    leerMock.mockResolvedValue(["hero", "anuncio"]);

    await cambiarVisibilidadSeccion("hero", "siempre");

    expect(guardarMock).toHaveBeenCalledWith("ocultas", { anuncio: "nunca", hero: "siempre" });
  });

  it("si la DB falla devuelve error sin lanzar", async () => {
    leerMock.mockRejectedValue(new Error("db caída"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await cambiarVisibilidadSeccion("hero", "nunca");

    expect(r).toEqual({ ok: false, errores: ["No se pudo guardar la sección. Inténtelo de nuevo."] });
  });
});

describe("guardarDatosLegales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    esAdminMock.mockResolvedValue(true);
    guardarMock.mockResolvedValue({ updatedAt: new Date("2026-09-25T00:00:00Z") });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("no admin: no escribe ni revalida", async () => {
    esAdminMock.mockResolvedValue(false);
    const r = await guardarDatosLegales({ razonSocial: "Comercio Ejemplo SA" });
    expect(r).toEqual({ ok: false, errores: ["No tiene permisos para editar los datos legales."] });
    expect(guardarMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("admin + válido: guarda normalizado en la key legal y revalida el layout", async () => {
    const r = await guardarDatosLegales({
      razonSocial: " Comercio Ejemplo SA ",
      cuit: "20123456786",
      email: "Legales@Cliente.Example",
      dataFiscalUrl: "http://qr.afip.gob.ar/?qr=EJEMPLO",
    });
    expect(r.ok).toBe(true);
    expect(guardarMock).toHaveBeenCalledWith("legal", {
      razonSocial: "Comercio Ejemplo SA",
      cuit: "20-12345678-6",
      email: "legales@cliente.example",
      dataFiscalUrl: "https://qr.afip.gob.ar/?qr=EJEMPLO",
    });
    expect(revalidateMock).toHaveBeenCalledWith("/", "layout");
  });

  it("admin + inválido: devuelve errores sin escribir", async () => {
    const r = await guardarDatosLegales({ cuit: "20-12345678-0" });
    expect(r).toEqual({ ok: false, errores: ["Indique un CUIT válido (11 dígitos)."] });
    expect(guardarMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("el upsert falla: error en usted, sin lanzar", async () => {
    guardarMock.mockRejectedValue(new Error("db caída"));
    const r = await guardarDatosLegales({ razonSocial: "Comercio Ejemplo SA" });
    expect(r).toEqual({ ok: false, errores: ["No se pudieron guardar los datos legales. Inténtelo de nuevo."] });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe("leerSeccionParaEditar (performance-mobile-shop 4a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    esAdminMock.mockResolvedValue(true);
  });

  it("no admin: error en usted y no lee la DB", async () => {
    esAdminMock.mockResolvedValue(false);

    const r = await leerSeccionParaEditar("hero");

    expect(r).toEqual({ ok: false, error: "No tiene permisos para editar esta sección." });
    expect(leerMock).not.toHaveBeenCalled();
  });

  it("sección desconocida: no lee la DB", async () => {
    const r = await leerSeccionParaEditar("legal");

    expect(r).toEqual({ ok: false, error: "La sección indicada no existe." });
    expect(leerMock).not.toHaveBeenCalled();
  });

  it("admin sin fila guardada: devuelve el default de la sección", async () => {
    leerMock.mockResolvedValue(undefined);

    const r = await leerSeccionParaEditar("servicios");

    expect(leerMock).toHaveBeenCalledWith("servicios");
    expect(r).toEqual({ ok: true, valor: DEFAULTS_HOME.servicios });
  });

  it("admin con fila: devuelve la fila tal como la ve la home (mergeada como en combinarContenidoHome)", async () => {
    const guardado = { ...DEFAULTS_HOME.anuncio, texto: "Envíos a todo el país" };
    leerMock.mockResolvedValue(guardado);

    const r = await leerSeccionParaEditar("anuncio");

    expect(r).toEqual({ ok: true, valor: expect.objectContaining({ texto: "Envíos a todo el país" }) });
  });

  it("destacados viejos sin skus/imagenes heredan los del default", async () => {
    const viejo: Record<string, unknown> = { ...DEFAULTS_HOME.destacados };
    delete viejo.skus;
    delete viejo.imagenes;
    leerMock.mockResolvedValue(viejo);

    const r = await leerSeccionParaEditar("destacados");

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor).toMatchObject({ skus: DEFAULTS_HOME.destacados.skus, imagenes: DEFAULTS_HOME.destacados.imagenes });
    }
  });

  it("navBadge apagado (jsonb null) se edita como null, no como el default", async () => {
    leerMock.mockResolvedValue(null);

    expect(await leerSeccionParaEditar("navBadge")).toEqual({ ok: true, valor: null });
  });

  it("la DB falla: error en usted, sin lanzar", async () => {
    leerMock.mockRejectedValue(new Error("db caída"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await leerSeccionParaEditar("hero");

    expect(r).toEqual({ ok: false, error: "No se pudo cargar la sección. Inténtelo de nuevo." });
  });

  it("los mensajes nuevos respetan el registro de usted", () => {
    for (const texto of ["No tiene permisos para editar esta sección.", "No se pudo cargar la sección. Inténtelo de nuevo."]) {
      expect(infracciones(`<p>${texto}</p>`, REGISTRO)).toEqual([]);
    }
  });
});
