import { beforeEach, describe, expect, it, vi } from "vitest";

const { leerMock } = vi.hoisted(() => ({ leerMock: vi.fn() }));

vi.mock("@/lib/home-guardar", () => ({ leerSeccionHome: leerMock }));

import { getDatosLegales } from "./home-datos";

describe("getDatosLegales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("lee la key legal y la resuelve", async () => {
    leerMock.mockResolvedValue({ razonSocial: " Comercio Ejemplo SA ", cuit: 5 });
    expect(await getDatosLegales()).toEqual({ razonSocial: "Comercio Ejemplo SA" });
    expect(leerMock).toHaveBeenCalledWith("legal");
  });

  it("sin fila → vacío", async () => {
    leerMock.mockResolvedValue(undefined);
    expect(await getDatosLegales()).toEqual({});
  });

  it("DB caída → defaults vacíos, sin lanzar", async () => {
    leerMock.mockRejectedValue(new Error("sin conexión"));
    expect(await getDatosLegales()).toEqual({});
    expect(console.error).toHaveBeenCalled();
  });
});
