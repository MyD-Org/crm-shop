import { beforeEach, describe, expect, it, vi } from "vitest";
import { MARCA_POR_DEFECTO } from "@/lib/marca-base";

const { leerMock, cacheLifeMock, cacheTagMock } = vi.hoisted(() => ({
  leerMock: vi.fn(),
  cacheLifeMock: vi.fn(),
  cacheTagMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ cacheLife: cacheLifeMock, cacheTag: cacheTagMock }));
vi.mock("@/lib/home-guardar", () => ({ leerSeccionesHome: leerMock }));
vi.mock("@/lib/marca", () => ({
  getMarca: async () => ({ ...MARCA_POR_DEFECTO, base: "generica", nombre: "Tienda Ejemplo" }),
}));
vi.mock("@/lib/home-datos", () => ({
  getDatosLegales: async () => ({ email: "ventas@cliente.example" }),
  getDatosFooter: async () => ({ whatsapp: "" }),
}));

import { PAGINAS_INSTITUCIONALES } from "./paginas";
import { getPaginaInstitucional, getPaginasPublicadas } from "./datos";

const filas = (o: Record<string, unknown>) => new Map(Object.entries(o));

describe("getPaginaInstitucional", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("lee las 5 claves pagina:<slug> en una sola consulta con tag home", async () => {
    leerMock.mockResolvedValue(filas({}));
    await getPaginaInstitucional("garantia");
    expect(leerMock).toHaveBeenCalledTimes(1);
    expect(leerMock).toHaveBeenCalledWith(PAGINAS_INSTITUCIONALES.map((p) => p.key));
    expect(cacheTagMock).toHaveBeenCalledWith("home");
  });

  it("sin fila => null (404)", async () => {
    leerMock.mockResolvedValue(filas({}));
    for (const { slug } of PAGINAS_INSTITUCIONALES) expect(await getPaginaInstitucional(slug)).toBeNull();
    expect(await getPaginasPublicadas()).toEqual([]);
  });

  it("publicada:false => null aunque tenga bloques", async () => {
    leerMock.mockResolvedValue(
      filas({ "pagina:garantia": { publicada: false, bloques: [{ titulo: "A", parrafos: ["b"] }] } }),
    );
    expect(await getPaginaInstitucional("garantia")).toBeNull();
    expect(await getPaginasPublicadas()).toEqual([]);
  });

  it("publicada sin bloques => texto base con la marca del tenant", async () => {
    leerMock.mockResolvedValue(filas({ "pagina:nosotros": { publicada: true } }));
    const p = await getPaginaInstitucional("nosotros");
    expect(p?.titulo).toBe("Nosotros");
    expect(JSON.stringify(p?.bloques)).toContain("Tienda Ejemplo");
    expect(JSON.stringify(p?.bloques)).not.toMatch(/central/i);
  });

  it("publicada con bloques vacíos o inválidos => texto base, nunca página en blanco", async () => {
    leerMock.mockResolvedValue(
      filas({
        "pagina:garantia": { publicada: true, bloques: [] },
        "pagina:contacto": { publicada: true, bloques: [{ titulo: "", parrafos: [] }] },
      }),
    );
    expect((await getPaginaInstitucional("garantia"))?.bloques.length).toBeGreaterThan(1);
    expect((await getPaginaInstitucional("contacto"))?.bloques.length).toBeGreaterThan(1);
  });

  it("publicada con bloques propios => esos bloques, saneados (el script no llega)", async () => {
    leerMock.mockResolvedValue(
      filas({
        "pagina:garantia": { publicada: true, bloques: [{ titulo: "Mi título", parrafos: ["<script>x()</script>Hola"] }] },
      }),
    );
    const p = await getPaginaInstitucional("garantia");
    expect(p?.bloques).toEqual([{ titulo: "Mi título", parrafos: ["x()Hola"] }]);
  });

  it("contacto base usa el correo legal", async () => {
    leerMock.mockResolvedValue(filas({ "pagina:contacto": { publicada: true } }));
    expect(JSON.stringify((await getPaginaInstitucional("contacto"))?.bloques)).toContain("ventas@cliente.example");
  });

  it("getPaginasPublicadas: solo las publicadas, con título y href", async () => {
    leerMock.mockResolvedValue(
      filas({ "pagina:garantia": { publicada: true }, "pagina:nosotros": { publicada: false }, "pagina:contacto": { publicada: true } }),
    );
    expect(await getPaginasPublicadas()).toEqual([
      { label: "Garantía", href: "/garantia" },
      { label: "Contacto", href: "/contacto" },
    ]);
  });

  it("base caída => nada publicado (404), con perfil degradado", async () => {
    leerMock.mockRejectedValue(new Error("sin conexión"));
    expect(await getPaginaInstitucional("garantia")).toBeNull();
    expect(await getPaginasPublicadas()).toEqual([]);
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("home");
  });
});
