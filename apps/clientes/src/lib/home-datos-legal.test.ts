import { beforeEach, describe, expect, it, vi } from "vitest";

const { leerMock } = vi.hoisted(() => ({ leerMock: vi.fn() }));

vi.mock("@/lib/home-guardar", () => ({ leerSeccionesHome: leerMock }));

import { getDatosFooter, getDatosLegales } from "./home-datos";
import { DEFAULTS_FOOTER } from "@/data/footer";

describe("getDatosLegales / getDatosFooter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
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
  });
});
