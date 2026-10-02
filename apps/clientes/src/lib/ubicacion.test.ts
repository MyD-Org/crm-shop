import { describe, expect, it } from "vitest";
import { claveProvincia } from "./sucursales";
import type { ConfigEnvio } from "./envio";
import {
  armarEleccion,
  armarUbicacion,
  envioFichaSegunUbicacion,
  normalizarCp,
  resolverUbicacion,
  serializarCookieUbicacion,
  TEXTOS_UBICACION,
  textoUbicacion,
  validarCookieUbicacion,
} from "./ubicacion";

const MISIONES = { localidad: "Posadas", provincia: claveProvincia("Misiones") };
const BA = { localidad: "Coronel Vidal", provincia: claveProvincia("Buenos Aires"), id: "06518010" };

describe("validarCookieUbicacion", () => {
  it("cookie válida (ida y vuelta)", () => {
    expect(validarCookieUbicacion(serializarCookieUbicacion({ tipo: "envio", ...BA }))).toEqual({ tipo: "envio", ...BA });
    expect(validarCookieUbicacion(serializarCookieUbicacion({ tipo: "envio", ...MISIONES }))).toEqual({
      tipo: "envio",
      ...MISIONES,
    });
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
  it("Usted está en <localidad>, <provincia> con el nombre de la provincia", () => {
    expect(textoUbicacion(MISIONES)).toBe("Usted está en Posadas, Misiones");
    expect(textoUbicacion(BA)).toBe("Usted está en Coronel Vidal, Buenos Aires");
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

const DIR_ID = "0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10";

describe("validarCookieUbicacion: formato nuevo y compatibilidad", () => {
  it("formato viejo {localidad, provincia, id} => tipo envío sin cp", () => {
    const v = validarCookieUbicacion(JSON.stringify({ localidad: "Coronel Vidal", provincia: BA.provincia, id: "06518010" }));
    expect(v).toEqual({ tipo: "envio", ...BA });
    expect(v).not.toHaveProperty("cp");
  });

  it("JSON inválido o forma inesperada => null sin lanzar", () => {
    for (const raw of ["{no", "[]", "5", '"x"', "null", JSON.stringify({ tipo: "retiro", sucursal: 5 })]) {
      expect(() => validarCookieUbicacion(raw)).not.toThrow();
    }
    expect(validarCookieUbicacion("{no")).toBeNull();
    expect(validarCookieUbicacion("[]")).toBeNull();
  });

  it("campos extra se ignoran", () => {
    const v = validarCookieUbicacion(JSON.stringify({ ...MISIONES, x: 1, tipo: "envio" }));
    expect(v).toEqual({ tipo: "envio", ...MISIONES });
  });

  it("tipo desconocido => null", () => {
    expect(validarCookieUbicacion(JSON.stringify({ ...MISIONES, tipo: "paloma" }))).toBeNull();
  });

  it("retiro con slug válido", () => {
    expect(validarCookieUbicacion(JSON.stringify({ tipo: "retiro", sucursal: "sucursal-a" }))).toEqual({
      tipo: "retiro",
      sucursal: "sucursal-a",
    });
  });

  it("retiro sin sucursal (local único)", () => {
    expect(validarCookieUbicacion(JSON.stringify({ tipo: "retiro" }))).toEqual({ tipo: "retiro" });
  });

  it("retiro con slug basura o inyección: el slug se descarta (no se acepta algo parecido)", () => {
    for (const sucursal of ["../etc", "A B", "<script>", "x".repeat(61), "MAYUS", "a;b"]) {
      expect(validarCookieUbicacion(JSON.stringify({ tipo: "retiro", sucursal }))).toBeNull();
    }
  });

  it("envío con direccionId guarda además el snapshot localidad/provincia/cp", () => {
    const v = validarCookieUbicacion(
      JSON.stringify({ tipo: "envio", ...MISIONES, cp: "3300", direccionId: DIR_ID }),
    );
    expect(v).toEqual({ tipo: "envio", ...MISIONES, cp: "3300", direccionId: DIR_ID });
  });

  it("direccionId con forma rara => cookie inválida", () => {
    expect(validarCookieUbicacion(JSON.stringify({ tipo: "envio", ...MISIONES, direccionId: "1; drop" }))).toBeNull();
  });

  it("cp inválido en la cookie se descarta pero la localidad se conserva", () => {
    expect(validarCookieUbicacion(JSON.stringify({ tipo: "envio", ...MISIONES, cp: "12" }))).toEqual({
      tipo: "envio",
      ...MISIONES,
    });
  });
});

describe("normalizarCp", () => {
  it("normaliza", () => {
    expect(normalizarCp(" 5000 ")).toBe("5000");
    expect(normalizarCp("c1425abc")).toBe("C1425ABC");
    expect(normalizarCp("c 1425 abc")).toBe("C1425ABC");
    expect(normalizarCp("C-1425-ABC")).toBe("C1425ABC");
  });
  it("rechaza lo inválido", () => {
    for (const cp of ["12", "ABCDE", "50000", "", "   ", "1425ABC", "C1425AB", "50 0!", "<b>5000", null, undefined, 5000]) {
      expect(normalizarCp(cp as never)).toBeNull();
    }
  });
});

describe("serializarCookieUbicacion reemplaza por completo", () => {
  it("retiro no arrastra campos de envío", () => {
    const json = JSON.parse(
      serializarCookieUbicacion({ tipo: "retiro", sucursal: "sucursal-a", ...MISIONES, direccionId: DIR_ID } as never),
    );
    expect(json).toEqual({ tipo: "retiro", sucursal: "sucursal-a" });
  });
  it("envío no arrastra sucursal", () => {
    const json = JSON.parse(
      serializarCookieUbicacion({ tipo: "envio", ...MISIONES, cp: "3300", sucursal: "sucursal-a" } as never),
    );
    expect(json).toEqual({ tipo: "envio", ...MISIONES, cp: "3300" });
  });
});

describe("armarEleccion", () => {
  it("construye envío validando localidad/provincia y normalizando cp", () => {
    expect(armarEleccion({ tipo: "envio", ...MISIONES, cp: " 3300 " })).toEqual({ tipo: "envio", ...MISIONES, cp: "3300" });
  });
  it("envío con provincia inválida => null", () => {
    expect(armarEleccion({ tipo: "envio", localidad: "X", provincia: "atlantis" })).toBeNull();
  });
});

describe("TEXTOS_UBICACION: registro de usted", () => {
  it("ningún texto usa tuteo, voseo ni coloquialismos", () => {
    const todo = Object.values(TEXTOS_UBICACION).join("\n");
    expect(todo).not.toMatch(/\b(tu|tus|te|vos|ojo|che|dale)\b/i);
  });
  it("el error de CP indica el formato", () => {
    expect(TEXTOS_UBICACION.cpInvalido).toBe(
      "Ingrese un código postal válido: 4 dígitos o formato CPA, por ejemplo 5000 o C1425ABC.",
    );
  });
});
