import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS_FOOTER } from "@/data/footer";
import { DEFAULTS_HOME } from "@/data/home-defaults";
import { MARCA_POR_DEFECTO, resolverMarcaPropia, type Marca } from "./marca-base";

/**
 * Contenido por sitio (change `marca-por-dominio`, S3): las funciones cacheadas reciben la clave
 * del sitio, así dos sitios no comparten resultado. Dominios de ejemplo (.example).
 */
const { guardarMock, todasMock, whatsappMock, marcaRef } = vi.hoisted(() => ({
  guardarMock: vi.fn(),
  todasMock: vi.fn(),
  whatsappMock: vi.fn(),
  marcaRef: { actual: null as unknown },
}));

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/home-guardar", () => ({
  leerSeccionesHome: guardarMock,
  leerTodasSeccionesHome: todasMock,
  leerWhatsappDelPrincipal: whatsappMock,
}));
vi.mock("@/lib/marca", () => ({ getMarca: async () => marcaRef.actual }));
vi.mock("@/lib/sitio-datos", () => ({
  leerDestinosExtra: async () => [{ etiqueta: "tienda-b", url: "https://tienda-b.example", marca: { nombre: "Tienda B" } }],
}));

import { getContenidoHome, getDatosFooter, getDatosLegales } from "./home-datos";

const PROPIA = resolverMarcaPropia({ nombre: "Tienda B" }, "Tienda B") as Marca;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SHOP_TENANT_ID", "tenant-datos");
  vi.stubEnv("SHOP_SITIO", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  todasMock.mockResolvedValue([]);
  guardarMock.mockResolvedValue(new Map());
  whatsappMock.mockResolvedValue("5491100000000");
});
afterEach(() => vi.unstubAllEnvs());

describe("dos sitios no comparten resultado", () => {
  it("la home, el footer y los legales se piden con la clave del sitio de cada despliegue", async () => {
    marcaRef.actual = PROPIA;
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
    await Promise.all([getContenidoHome(), getDatosFooter(), getDatosLegales()]);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cliente.example");
    marcaRef.actual = MARCA_POR_DEFECTO;
    await Promise.all([getContenidoHome(), getDatosFooter(), getDatosLegales()]);

    expect(todasMock.mock.calls.map((c) => c[0])).toEqual(["https://tienda-b.example|", "https://cliente.example|"]);
    const sitiosFooter = new Set(guardarMock.mock.calls.map((c) => c[1]));
    expect([...sitiosFooter].sort()).toEqual(["https://cliente.example|", "https://tienda-b.example|"]);
  });
});

describe("defaults del sitio propio", () => {
  beforeEach(() => {
    marcaRef.actual = PROPIA;
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
  });

  it("sin fila propia, home y footer genéricos: nada de Central", async () => {
    whatsappMock.mockResolvedValue("");
    const salida = JSON.stringify([await getContenidoHome(), await getDatosFooter(), await getDatosLegales()]);
    expect(salida).not.toMatch(/central|iguaz|centralled/i);
    expect(salida).not.toContain("/images/central-led");
    expect((await getDatosFooter()).redes).toEqual([]);
    expect((await getDatosFooter()).locales).toEqual([]);
  });
});

describe("WhatsApp compartido", () => {
  it("un sitio propio sin número toma el del principal, y sólo ese campo", async () => {
    marcaRef.actual = PROPIA;
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
    guardarMock.mockResolvedValue(new Map([["footer", { descripcion: "Propia" }]]));
    const footer = await getDatosFooter();
    expect(footer.whatsapp).toBe("5491100000000");
    expect(footer.descripcion).toBe("Propia");
    expect(footer.redes).toEqual([]);
    expect(footer.locales).toEqual([]);
  });

  it("si el sitio propio carga el suyo, manda el suyo", async () => {
    marcaRef.actual = PROPIA;
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda-b.example");
    guardarMock.mockResolvedValue(new Map([["footer", { whatsapp: "5491122222222" }]]));
    expect((await getDatosFooter()).whatsapp).toBe("5491122222222");
    expect(whatsappMock).not.toHaveBeenCalled();
  });

  it("el principal no consulta el número de nadie y queda como hoy", async () => {
    marcaRef.actual = MARCA_POR_DEFECTO;
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cliente.example");
    expect(await getDatosFooter()).toEqual(DEFAULTS_FOOTER);
    expect(await getContenidoHome()).toEqual(DEFAULTS_HOME);
    expect(whatsappMock).not.toHaveBeenCalled();
  });
});
