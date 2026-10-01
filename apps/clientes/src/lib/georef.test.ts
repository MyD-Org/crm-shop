import { describe, expect, it, vi } from "vitest";
import fixtures from "./__fixtures__/georef-respuestas.json";
import { PROVINCIAS_AR } from "./provincias";
import { claveProvincia } from "./sucursales";
import {
  GeorefError,
  buscarLocalidades,
  coordenadasValidas,
  localidadPorId,
  normalizarBusqueda,
  provinciaDeGeoref,
  ubicacionPorCoordenadas,
} from "./georef";

const json = (cuerpo: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(cuerpo), { status })) as unknown as typeof fetch;

const llamada = (f: typeof fetch) => new URL(String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));

describe("provinciaDeGeoref", () => {
  it("cubre las 24 jurisdicciones oficiales de Georef, cada una a una provincia distinta del Shop", () => {
    const claves = fixtures.provincias.map((n) => provinciaDeGeoref(n));
    expect(claves).not.toContain(null);
    expect(new Set(claves).size).toBe(24);
    expect(new Set(claves)).toEqual(new Set(PROVINCIAS_AR.map((p) => claveProvincia(p))));
  });

  it("nombres que difieren de los del selector", () => {
    expect(provinciaDeGeoref("Tierra del Fuego, Antártida e Islas del Atlántico Sur")).toBe(claveProvincia("Tierra del Fuego"));
    expect(provinciaDeGeoref("Ciudad Autónoma de Buenos Aires")).toBe(claveProvincia("CABA"));
  });

  it("lo desconocido es null", () => {
    expect(provinciaDeGeoref("Atlantis")).toBeNull();
    expect(provinciaDeGeoref("")).toBeNull();
    expect(provinciaDeGeoref(null)).toBeNull();
  });
});

describe("coordenadasValidas", () => {
  it("acepta puntos de Argentina", () => {
    expect(coordenadasValidas(-25.6, -54.57)).toBe(true);
    expect(coordenadasValidas(-54.8, -68.3)).toBe(true);
  });
  it("rechaza fuera de rango, no numéricas y no finitas", () => {
    expect(coordenadasValidas(40.4, -3.7)).toBe(false);
    expect(coordenadasValidas(-25.6, 200)).toBe(false);
    expect(coordenadasValidas("-25.6", "-54.57")).toBe(false);
    expect(coordenadasValidas(NaN, -54)).toBe(false);
    expect(coordenadasValidas(undefined, undefined)).toBe(false);
  });
});

describe("normalizarBusqueda", () => {
  it("minúsculas, sin tildes y con espacios colapsados", () => {
    expect(normalizarBusqueda("  CÓRDOBA   Capital ")).toBe("cordoba capital");
    expect(normalizarBusqueda("Coronel Vid")).toBe("coronel vid");
  });
});

describe("ubicacionPorCoordenadas", () => {
  it("devuelve municipio y provincia (clave)", async () => {
    const f = json(fixtures.ubicacion);
    await expect(ubicacionPorCoordenadas(-25.6, -54.57, f)).resolves.toEqual({
      localidad: "Puerto Iguazú",
      provincia: claveProvincia("Misiones"),
    });
    const url = llamada(f);
    expect(url.pathname).toBe("/georef/api/ubicacion");
    expect(url.searchParams.get("lat")).toBe("-25.6");
    expect(url.searchParams.get("lon")).toBe("-54.57");
  });

  it("sin municipio usa el departamento", async () => {
    const f = json({
      ubicacion: { provincia: { nombre: "Misiones" }, departamento: { nombre: "Iguazú" }, municipio: { nombre: null } },
    });
    await expect(ubicacionPorCoordenadas(-25.6, -54.57, f)).resolves.toEqual({
      localidad: "Iguazú",
      provincia: claveProvincia("Misiones"),
    });
  });

  it("Georef sin provincia = null (punto fuera del país)", async () => {
    const f = json({ ubicacion: { provincia: { nombre: null }, departamento: { nombre: null }, municipio: { nombre: null } } });
    await expect(ubicacionPorCoordenadas(-30, -60, f)).resolves.toBeNull();
  });

  it("5xx, respuesta rota y timeout salen como GeorefError tipado", async () => {
    await expect(ubicacionPorCoordenadas(-25, -54, json({}, 503))).rejects.toMatchObject({ motivo: "upstream" });
    await expect(ubicacionPorCoordenadas(-25, -54, json({ otra: 1 }))).rejects.toMatchObject({ motivo: "respuesta" });
    const roto = vi.fn(async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    await expect(ubicacionPorCoordenadas(-25, -54, roto)).rejects.toMatchObject({ motivo: "respuesta" });
    const lento = vi.fn(async () => {
      throw new DOMException("timeout", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(ubicacionPorCoordenadas(-25, -54, lento)).rejects.toBeInstanceOf(GeorefError);
    await expect(ubicacionPorCoordenadas(-25, -54, lento)).rejects.toMatchObject({ motivo: "timeout" });
    const sinRed = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(ubicacionPorCoordenadas(-25, -54, sinRed)).rejects.toMatchObject({ motivo: "upstream" });
  });
});

describe("buscarLocalidades", () => {
  it("consulta normalizada, máx 8 y con provincia para distinguir homónimas", async () => {
    const f = json(fixtures.localidades);
    const r = await buscarLocalidades("Coronel Vid", f);
    expect(r).toEqual([
      { id: "06518010", localidad: "Coronel Vidal", provincia: claveProvincia("Buenos Aires"), provinciaNombre: "Buenos Aires" },
    ]);
    const url = llamada(f);
    expect(url.pathname).toBe("/georef/api/localidades");
    expect(url.searchParams.get("nombre")).toBe("coronel vid");
    expect(url.searchParams.get("max")).toBe("8");
    expect(url.searchParams.get("campos")).toBe("id,nombre,provincia.nombre,municipio.nombre");
  });

  it("menos de 4 caracteres no llama a Georef", async () => {
    const f = json(fixtures.localidades);
    await expect(buscarLocalidades("pos", f)).resolves.toEqual([]);
    await expect(buscarLocalidades("  po ", f)).resolves.toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("sin coincidencias = lista vacía; descarta entradas sin provincia conocida o con id raro", async () => {
    await expect(buscarLocalidades("zzzzzz", json({ localidades: [] }))).resolves.toEqual([]);
    const f = json({
      localidades: [
        { id: "1", nombre: "Rara", provincia: { nombre: "Atlantis" } },
        { id: "abc", nombre: "Mala", provincia: { nombre: "Salta" } },
        { id: "66028010", nombre: "Salta", provincia: { nombre: "Salta" } },
      ],
    });
    const r = await buscarLocalidades("salt", f);
    expect(r.map((x) => x.id)).toEqual(["66028010"]);
  });

  it("Georef caído", async () => {
    await expect(buscarLocalidades("coronel", json({}, 500))).rejects.toMatchObject({ motivo: "upstream" });
    await expect(buscarLocalidades("coronel", json({ x: 1 }))).rejects.toMatchObject({ motivo: "respuesta" });
  });
});

describe("localidadPorId", () => {
  it("re-resuelve por id", async () => {
    const f = json(fixtures.localidades);
    const r = await localidadPorId("06518010", f);
    expect(r?.provincia).toBe(claveProvincia("Buenos Aires"));
    expect(llamada(f).searchParams.get("id")).toBe("06518010");
  });
  it("id con forma inválida no llama a Georef", async () => {
    const f = json(fixtures.localidades);
    await expect(localidadPorId("../x", f)).resolves.toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("id inexistente = null", async () => {
    await expect(localidadPorId("999", json({ localidades: [] }))).resolves.toBeNull();
  });
});
