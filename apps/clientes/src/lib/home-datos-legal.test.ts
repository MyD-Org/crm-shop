import { beforeEach, describe, expect, it, vi } from "vitest";

const { leerMock, cacheLifeMock, cacheTagMock } = vi.hoisted(() => ({
  leerMock: vi.fn(),
  cacheLifeMock: vi.fn(),
  cacheTagMock: vi.fn(),
}));

vi.mock("@/lib/home-guardar", () => ({ leerSeccionesHome: leerMock }));
// `'use cache'` es un string suelto fuera de Next: sólo se mockean tag y vida.
vi.mock("next/cache", () => ({ cacheLife: cacheLifeMock, cacheTag: cacheTagMock }));

import { getDatosFooter, getDatosLegales } from "./home-datos";
import { DEFAULTS_FOOTER } from "@/data/footer";

describe("getDatosLegales / getDatosFooter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("lee las keys legal y footer en una sola consulta y resuelve cada una", async () => {
    leerMock.mockResolvedValue(
      new Map<string, unknown>([
        ["legal", { razonSocial: " Comercio Ejemplo SA ", cuit: 5 }],
        ["footer", { descripcion: "Otra descripción" }],
      ]),
    );
    expect(await getDatosLegales()).toEqual({ razonSocial: "Comercio Ejemplo SA" });
    expect(await getDatosFooter()).toEqual({ ...DEFAULTS_FOOTER, descripcion: "Otra descripción" });
    expect(leerMock).toHaveBeenCalledWith(["legal", "footer"]);
    expect(cacheTagMock).toHaveBeenCalledWith("home");
    expect(cacheLifeMock).toHaveBeenCalledWith("home");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("degradado");
  });

  it("sin filas → vacío y footer por defecto", async () => {
    leerMock.mockResolvedValue(new Map());
    expect(await getDatosLegales()).toEqual({});
    expect(await getDatosFooter()).toEqual(DEFAULTS_FOOTER);
  });

  it("DB caída → defaults, sin lanzar", async () => {
    leerMock.mockRejectedValue(new Error("sin conexión"));
    expect(await getDatosLegales()).toEqual({});
    expect(await getDatosFooter()).toEqual(DEFAULTS_FOOTER);
    expect(console.error).toHaveBeenCalled();
    // El fallback nunca se guarda con la vida larga de la home.
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("home");
  });
});
