import { describe, expect, it } from "vitest";
import { claveProvincia } from "./sucursales";
import type { ConfigEnvio } from "./envio";
import {
  armarUbicacion,
  envioFichaSegunUbicacion,
  resolverUbicacion,
  serializarCookieUbicacion,
  textoUbicacion,
  validarCookieUbicacion,
} from "./ubicacion";

const MISIONES = { localidad: "Posadas", provincia: claveProvincia("Misiones") };
const BA = { localidad: "Coronel Vidal", provincia: claveProvincia("Buenos Aires"), id: "06518010" };

describe("validarCookieUbicacion", () => {
  it("cookie válida (ida y vuelta)", () => {
    expect(validarCookieUbicacion(serializarCookieUbicacion(BA))).toEqual(BA);
    expect(validarCookieUbicacion(serializarCookieUbicacion(MISIONES))).toEqual(MISIONES);
  });

  it("manipulada o rota se ignora sin error", () => {
    expect(validarCookieUbicacion(undefined)).toBeNull();
    expect(validarCookieUbicacion("")).toBeNull();
    expect(validarCookieUbicacion("{no es json")).toBeNull();
    expect(validarCookieUbicacion("[1,2]")).toBeNull();
    expect(validarCookieUbicacion("null")).toBeNull();
    expect(validarCookieUbicacion(JSON.stringify({ localidad: "X", provincia: "atlantis" }))).toBeNull();
    expect(validarCookieUbicacion(JSON.stringify({ localidad: 5, provincia: MISIONES.provincia }))).toBeNull();
    expect(validarCookieUbicacion(JSON.stringify({ localidad: "", provincia: MISIONES.provincia }))).toBeNull();
    expect(
      validarCookieUbicacion(JSON.stringify({ localidad: "x".repeat(200), provincia: MISIONES.provincia })),
    ).toBeNull();
  });

  it("provincia con nombre (no clave) no vale: la cookie guarda claves", () => {
    expect(validarCookieUbicacion(JSON.stringify({ localidad: "Posadas", provincia: "Misiones" }))).toBeNull();
  });

  it("limpia caracteres de control y marcas y descarta ids raros", () => {
    const u = armarUbicacion({ localidad: "  Pos\u0000adas <b> ", provincia: MISIONES.provincia, id: "../1" });
    expect(u).toEqual({ localidad: "Posadas b", provincia: MISIONES.provincia });
  });
});

describe("resolverUbicacion", () => {
  it("la cookie (elección explícita) le gana a la dirección guardada", () => {
    const r = resolverUbicacion({
      direccionGuardada: { ciudad: "Posadas", provincia: "Misiones" },
      cookie: BA,
    });
    expect(r.origen).toBe("cookie");
    expect(r.ubicacion).toEqual(BA);
  });

  it("sin cookie usa la dirección guardada", () => {
    const r = resolverUbicacion({ direccionGuardada: { ciudad: "Posadas", provincia: "Misiones" }, cookie: null });
    expect(r.origen).toBe("direccion");
    expect(r.ubicacion).toEqual(MISIONES);
  });

  it("sin cookie y con dirección no usable (provincia desconocida o vacía): sin ubicación", () => {
    expect(resolverUbicacion({ direccionGuardada: { ciudad: "Posadas", provincia: null } })).toEqual({
      ubicacion: null,
      origen: "ninguna",
    });
    expect(resolverUbicacion({ direccionGuardada: { ciudad: "X", provincia: "Atlantis" } }).origen).toBe("ninguna");
  });

  it("sin nada: sin ubicación", () => {
    expect(resolverUbicacion({})).toEqual({ ubicacion: null, origen: "ninguna" });
    expect(resolverUbicacion({ direccionGuardada: null, cookie: null })).toEqual({ ubicacion: null, origen: "ninguna" });
  });
});

describe("textoUbicacion", () => {
  it("Estás en <localidad>, <provincia> con el nombre de la provincia", () => {
    expect(textoUbicacion(MISIONES)).toBe("Estás en Posadas, Misiones");
    expect(textoUbicacion(BA)).toBe("Estás en Coronel Vidal, Buenos Aires");
  });
});

describe("envioFichaSegunUbicacion (fila de envío de la ficha)", () => {
  const gratisMisiones = (minimo: number | null): ConfigEnvio => ({
    domicilioActivo: true,
    gratis: { alcance: "provincias", provincias: [MISIONES.provincia], minimo },
  });
  const texto = (r: ReturnType<typeof envioFichaSegunUbicacion>) => (r && r.tipo === "texto" ? r.texto : r);

  it("envío desactivado: sin fila", () => {
    expect(envioFichaSegunUbicacion({ domicilioActivo: false, gratis: null }, MISIONES)).toBeNull();
  });

  it("sin ubicación y gratis por provincias: invita a ingresar la localidad", () => {
    expect(envioFichaSegunUbicacion(gratisMisiones(null), null)).toEqual({ tipo: "pedir" });
    expect(envioFichaSegunUbicacion(gratisMisiones(100000), null)).toEqual({ tipo: "pedir" });
  });

  it("sin ubicación pero la ubicación no cambia nada: la regla general", () => {
    expect(envioFichaSegunUbicacion({ domicilioActivo: true, gratis: null }, null)).toEqual({ tipo: "pedir" });
    expect(
      envioFichaSegunUbicacion({ domicilioActivo: true, gratis: { alcance: "pais", provincias: [], minimo: null } }, null),
    ).toEqual({ tipo: "pedir" });
  });

  it("con ubicación en alcance sin mínimo: Gratis a <localidad>", () => {
    expect(texto(envioFichaSegunUbicacion(gratisMisiones(null), MISIONES))).toBe("Gratis a Posadas");
  });

  it("con ubicación en alcance y mínimo: gratis desde $X, si no a coordinar", () => {
    expect(texto(envioFichaSegunUbicacion(gratisMisiones(100000), MISIONES))).toMatch(/^Gratis desde .* · si no, costo a coordinar$/);
  });

  it("con ubicación fuera de alcance: costo a coordinar", () => {
    expect(texto(envioFichaSegunUbicacion(gratisMisiones(null), BA))).toBe("Costo de envío a coordinar");
  });
});
