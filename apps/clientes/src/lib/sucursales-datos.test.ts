import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheTag = vi.fn();
const cacheLife = vi.fn();
vi.mock("next/cache", () => ({
  cacheTag: (...a: unknown[]) => cacheTag(...a),
  cacheLife: (...a: unknown[]) => cacheLife(...a),
}));
const leer = vi.fn();
vi.mock("./sucursales-repo", () => ({
  leerSucursalesYZonas: (...a: unknown[]) => leer(...a),
}));

import { sucursalesCacheadas } from "./sucursales-datos";

beforeEach(() => {
  cacheTag.mockReset();
  cacheLife.mockReset();
  leer.mockReset();
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
