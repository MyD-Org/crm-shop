import { beforeEach, describe, expect, it, vi } from "vitest";
import { MARCA_POR_DEFECTO } from "@/lib/marca-base";

const { esAdminMock, guardarMock, borrarMock, leerSeccionesMock, updateTagMock } = vi.hoisted(() => ({
  esAdminMock: vi.fn(),
  guardarMock: vi.fn(),
  borrarMock: vi.fn(),
  leerSeccionesMock: vi.fn(),
  updateTagMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ esAdmin: esAdminMock }));
vi.mock("next/cache", () => ({ updateTag: updateTagMock }));
vi.mock("@/lib/home-guardar", () => ({
  guardarSeccionHome: guardarMock,
  borrarSeccionHome: borrarMock,
  leerSeccionesHome: leerSeccionesMock,
}));
vi.mock("@/lib/marca", () => ({ getMarca: async () => ({ ...MARCA_POR_DEFECTO, base: "generica", nombre: "Tienda Ejemplo" }) }));
vi.mock("@/lib/home-datos", () => ({
  getDatosLegales: async () => ({}),
  getDatosFooter: async () => ({ whatsapp: "" }),
}));

import { guardarPaginaInstitucional, leerPaginasParaEditor, restablecerPaginaInstitucional } from "./paginas-acciones";

const OK = { publicada: true, bloques: [{ titulo: "Mi título", parrafos: ["Un párrafo."] }] };

describe("paginas-acciones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    esAdminMock.mockResolvedValue(true);
    guardarMock.mockResolvedValue({ updatedAt: new Date("2026-01-01T00:00:00Z") });
    leerSeccionesMock.mockResolvedValue(new Map());
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("no admin: rechazado y no escribe", async () => {
    esAdminMock.mockResolvedValue(false);
    const r = await guardarPaginaInstitucional("garantia", OK);
    expect(r.ok).toBe(false);
    expect(guardarMock).not.toHaveBeenCalled();
    expect((await restablecerPaginaInstitucional("garantia")).ok).toBe(false);
    expect(borrarMock).not.toHaveBeenCalled();
    expect((await leerPaginasParaEditor()).ok).toBe(false);
    expect(updateTagMock).not.toHaveBeenCalled();
  });

  it("slug desconocido (p. ej. la legal /envios-y-pagos o una key ajena): rechazado", async () => {
    for (const slug of ["envios-y-pagos", "legal", "../footer", "hero"]) {
      const r = await guardarPaginaInstitucional(slug, OK);
      expect(r.ok).toBe(false);
    }
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("guarda solo bajo la key pagina:<slug> con el payload saneado, e invalida home", async () => {
    const r = await guardarPaginaInstitucional("garantia", {
      publicada: true,
      bloques: [{ titulo: "<i>T</i>", parrafos: ["<script>x</script>P"] }],
    });
    expect(r).toEqual({ ok: true, updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(guardarMock).toHaveBeenCalledWith("pagina:garantia", {
      publicada: true,
      bloques: [{ titulo: "T", parrafos: ["xP"] }],
    });
    expect(updateTagMock).toHaveBeenCalledWith("home");
  });

  it("payload inválido: errores en usted y no escribe", async () => {
    const r = await guardarPaginaInstitucional("garantia", { publicada: "si" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.length).toBeGreaterThan(0);
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("nunca lanza: si la base falla devuelve error en usted", async () => {
    guardarMock.mockRejectedValue(new Error("db"));
    const r = await guardarPaginaInstitucional("garantia", OK);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.join(" ")).toMatch(/inténtelo/i);
    borrarMock.mockRejectedValue(new Error("db"));
    expect((await restablecerPaginaInstitucional("garantia")).ok).toBe(false);
  });

  it("restablecer publicada: conserva la publicación y quita los bloques", async () => {
    leerSeccionesMock.mockResolvedValue(new Map([["pagina:garantia", OK]]));
    const r = await restablecerPaginaInstitucional("garantia");
    expect(r.ok).toBe(true);
    expect(guardarMock).toHaveBeenCalledWith("pagina:garantia", { publicada: true });
    expect(updateTagMock).toHaveBeenCalledWith("home");
  });

  it("restablecer no publicada: borra la fila", async () => {
    leerSeccionesMock.mockResolvedValue(new Map([["pagina:garantia", { publicada: false, bloques: OK.bloques }]]));
    await restablecerPaginaInstitucional("garantia");
    expect(borrarMock).toHaveBeenCalledWith("pagina:garantia");
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("lectura para el editor: las 5, con texto base cuando no hay bloques propios", async () => {
    leerSeccionesMock.mockResolvedValue(new Map([["pagina:garantia", OK]]));
    const r = await leerPaginasParaEditor();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.paginas.map((p) => p.slug)).toHaveLength(5);
    const g = r.paginas.find((p) => p.slug === "garantia")!;
    expect(g).toMatchObject({ publicada: true, personalizada: true, bloques: OK.bloques });
    const n = r.paginas.find((p) => p.slug === "nosotros")!;
    expect(n).toMatchObject({ publicada: false, personalizada: false });
    expect(JSON.stringify(n.bloques)).toContain("Tienda Ejemplo");
  });
});
