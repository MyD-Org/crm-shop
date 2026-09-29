import { describe, expect, it } from "vitest";
import casos from "./__fixtures__/sucursales-casos.json";
import { asignarSucursal, claveProvincia, resolverZona, type SucursalDato, type ZonaDato } from "./sucursales";
import { PROVINCIAS_AR } from "./provincias";

type Dataset = { sucursales: SucursalDato[]; zonas: ZonaDato[] };
const datasets = casos.datasets as Record<string, Dataset>;

describe("resolverZona (fixture compartido con el CRM)", () => {
  for (const c of casos.resolverZona) {
    it(c.caso, () => {
      const d = datasets[c.dataset];
      expect(resolverZona(c.provincia, d.zonas, d.sucursales)).toEqual(c.esperado);
    });
  }
});

describe("asignarSucursal (fixture compartido con el CRM)", () => {
  for (const c of casos.asignarSucursal) {
    it(c.caso, () => {
      const d = datasets[c.dataset];
      expect(asignarSucursal(c.entrada as never, d)).toEqual(c.esperado);
    });
  }
});

describe("determinismo", () => {
  it("las mismas reglas y la misma entrada dan exactamente el mismo resultado", () => {
    const d = datasets.base;
    const entrada = { entregaTipo: "envio" as const, provincia: "Misiones", ciudad: "Puerto Iguazú" };
    const a = asignarSucursal(entrada, d);
    const b = asignarSucursal(entrada, d);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("no depende del orden en que vienen las sucursales ni las zonas", () => {
    const d = datasets.zona_inactiva;
    const invertido = { sucursales: [...d.sucursales].reverse(), zonas: [...d.zonas].reverse() };
    const entrada = { entregaTipo: "envio" as const, provincia: "Córdoba", ciudad: "Córdoba" };
    expect(asignarSucursal(entrada, invertido)).toEqual(asignarSucursal(entrada, d));
  });

  it("no muta los datos de entrada", () => {
    const d = structuredClone(datasets.base);
    asignarSucursal({ entregaTipo: "envio", provincia: "Misiones", ciudad: "El Dorado" }, d);
    expect(d).toEqual(datasets.base);
  });
});

describe("claveProvincia", () => {
  it("normaliza acentos, mayúsculas, espacios y alias de CABA", () => {
    expect(claveProvincia(" TUCUMÁN ")).toBe("tucuman");
    expect(claveProvincia("Entre Rios")).toBe(claveProvincia("Entre Ríos"));
    expect(claveProvincia("Capital Federal")).toBe("ciudadautonomadebuenosaires");
    expect(claveProvincia("CABA")).toBe("ciudadautonomadebuenosaires");
  });

  it("todas las jurisdicciones tienen clave y no se pisan", () => {
    const claves = PROVINCIAS_AR.map((p) => claveProvincia(p));
    expect(claves.every(Boolean)).toBe(true);
    expect(new Set(claves).size).toBe(24);
  });

  it("un texto que no es una provincia da clave vacía y cae en el default", () => {
    expect(claveProvincia("Narnia")).toBe("");
    expect(claveProvincia("")).toBe("");
    expect(claveProvincia(null)).toBe("");
  });
});
