import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheTag = vi.fn();
const cacheLife = vi.fn();
vi.mock("next/cache", () => ({
  cacheTag: (...a: unknown[]) => cacheTag(...a),
  cacheLife: (...a: unknown[]) => cacheLife(...a),
}));
const leer = vi.fn();
const leerReglas = vi.fn();
const leerEnvio = vi.fn();
vi.mock("./sucursales-repo", async (orig) => ({
  ...(await orig<typeof import("./sucursales-repo")>()),
  leerSucursalesYZonas: (...a: unknown[]) => leer(...a),
  leerReglasVenta: (...a: unknown[]) => leerReglas(...a),
  leerConfigEnvio: (...a: unknown[]) => leerEnvio(...a),
}));

import { reglasVentaCacheadas, sucursalesCacheadas } from "./sucursales-datos";
import { CONFIG_ENVIO_DEFAULT } from "./envio";
import { REGLAS_VENTA_DEFAULT } from "./sucursales-repo";

beforeEach(() => {
  cacheTag.mockReset();
  cacheLife.mockReset();
  leer.mockReset();
  leerReglas.mockReset();
  leerEnvio.mockReset();
});

describe("sucursalesCacheadas", () => {
  it("cachea con el tag sucursales y el perfil sucursales", async () => {
    leer.mockResolvedValue({ sucursales: [], zonas: [] });
    await sucursalesCacheadas();
    expect(cacheTag).toHaveBeenCalledWith("sucursales");
    expect(cacheLife).toHaveBeenCalledWith("sucursales");
  });

  it("si la lectura falla: vacío con perfil degradado, sin tirar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    leer.mockRejectedValue(new Error("base caída"));
    expect(await sucursalesCacheadas()).toEqual({ sucursales: [], zonas: [] });
    expect(cacheLife).toHaveBeenCalledWith("degradado");
  });
});

describe("reglasVentaCacheadas", () => {
  it("suma la config de envío (leída aparte) con el tag y el perfil sucursales", async () => {
    const envio = { domicilioActivo: true, gratis: { alcance: "pais" as const, provincias: [], minimo: null } };
    leerReglas.mockResolvedValue({ ...REGLAS_VENTA_DEFAULT });
    leerEnvio.mockResolvedValue(envio);
    const r = await reglasVentaCacheadas();
    expect(r.envio).toEqual(envio);
    expect(cacheTag).toHaveBeenCalledWith("sucursales");
    expect(cacheLife).toHaveBeenCalledWith("sucursales");
  });

  it("si falla: los defaults (domicilio activo, sin gratis) con perfil degradado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    leerReglas.mockRejectedValue(new Error("base caída"));
    leerEnvio.mockResolvedValue(CONFIG_ENVIO_DEFAULT);
    const r = await reglasVentaCacheadas();
    expect(r.envio ?? CONFIG_ENVIO_DEFAULT).toEqual(CONFIG_ENVIO_DEFAULT);
    expect(cacheLife).toHaveBeenCalledWith("degradado");
  });
});
