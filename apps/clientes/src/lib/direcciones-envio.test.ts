import { describe, expect, it } from "vitest";
import { CIUDADES_ENVIO } from "./envio";
import {
  LARGOS_DIRECCION,
  MAX_DIRECCIONES,
  avisoFueraDeZona,
  entregaDesdeGuardada,
  esIdDireccion,
  etiquetaDireccion,
  fueraDeZona,
  lineaEntrega,
  lineasDireccion,
  normalizarCp,
  opcionDireccion,
  validarDireccion,
  type DireccionEnvio,
} from "./direcciones-envio";

const valida = {
  etiqueta: "Casa",
  calle: "Av. Victoria Aguirre 100",
  ciudad: "Puerto Iguazú",
  provincia: "Misiones",
  cp: "3370",
  referencias: "Portón verde",
};

const guardada = (extra: Partial<DireccionEnvio> = {}): DireccionEnvio => ({
  id: "0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10",
  etiqueta: "Casa",
  calle: "Av. Victoria Aguirre 100",
  ciudad: "Puerto Iguazú",
  provincia: "Misiones",
  cp: "3370",
  referencias: null,
  predeterminada: true,
  ...extra,
});

describe("MAX_DIRECCIONES", () => {
  it("diez por usuario (decisión del usuario)", () => {
    expect(MAX_DIRECCIONES).toBe(10);
  });
});

describe("validarDireccion", () => {
  it("acepta una dirección completa y la normaliza", () => {
    const r = validarDireccion({
      ...valida,
      etiqueta: "  Casa ",
      calle: " Av.  Victoria   Aguirre 100 ",
      provincia: "misiones",
      cp: " 3370 ",
    });
    expect(r).toEqual({
      ok: true,
      datos: {
        etiqueta: "Casa",
        calle: "Av. Victoria Aguirre 100",
        ciudad: "Puerto Iguazú",
        provincia: "Misiones",
        cp: "3370",
        referencias: "Portón verde",
        predeterminada: false,
      },
    });
  });

  it("etiqueta y referencias son opcionales (vacías quedan en null)", () => {
    const r = validarDireccion({ ...valida, etiqueta: "   ", referencias: undefined });
    expect(r.ok && r.datos.etiqueta).toBeNull();
    expect(r.ok && r.datos.referencias).toBeNull();
  });

  it("acepta cualquier localidad del país (no sólo la zona de envío)", () => {
    const r = validarDireccion({
      ...valida,
      ciudad: "Rosario",
      provincia: "Santa Fe",
      cp: "S2000ABC",
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.datos.cp).toBe("S2000ABC");
  });

  it("predeterminada sólo con true explícito", () => {
    expect(validarDireccion({ ...valida, predeterminada: true })).toMatchObject({
      ok: true,
      datos: { predeterminada: true },
    });
    expect(validarDireccion({ ...valida, predeterminada: "sí" })).toMatchObject({
      ok: true,
      datos: { predeterminada: false },
    });
  });

  it("cuerpo que no es un objeto → motivo 'cuerpo'", () => {
    for (const cuerpo of [null, undefined, "hola", 42, [valida]]) {
      expect(validarDireccion(cuerpo)).toEqual({ ok: false, motivo: "cuerpo" });
    }
  });

  it("marca cada campo obligatorio faltante, con mensajes en usted", () => {
    const r = validarDireccion({});
    expect(r).toEqual({
      ok: false,
      motivo: "campos",
      errores: {
        calle: "Indique la calle y el número.",
        ciudad: "Indique la localidad.",
        provincia: "Seleccione la provincia.",
        cp: "Indique el código postal.",
      },
    });
  });

  it("provincia que no es argentina y CP con formato inválido", () => {
    const r = validarDireccion({ ...valida, provincia: "Alto Paraná", cp: "33-70" });
    expect(r).toMatchObject({
      ok: false,
      motivo: "campos",
      errores: {
        provincia: "Seleccione la provincia.",
        cp: "Indique un código postal válido (por ejemplo, 3370).",
      },
    });
  });

  it("rechaza textos más largos que el máximo de cada campo", () => {
    const r = validarDireccion({
      ...valida,
      etiqueta: "x".repeat(LARGOS_DIRECCION.etiqueta + 1),
      calle: "x".repeat(LARGOS_DIRECCION.calle + 1),
      ciudad: "x".repeat(LARGOS_DIRECCION.ciudad + 1),
      referencias: "x".repeat(LARGOS_DIRECCION.referencias + 1),
    });
    expect(r.ok).toBe(false);
    if (r.ok || r.motivo !== "campos") throw new Error("esperaba errores de campos");
    expect(Object.keys(r.errores).sort()).toEqual(["calle", "ciudad", "etiqueta", "referencias"]);
    expect(r.errores.etiqueta).toBe(`Use hasta ${LARGOS_DIRECCION.etiqueta} caracteres.`);
  });

  it("un campo que no es string cuenta como faltante", () => {
    const r = validarDireccion({ ...valida, calle: 123 });
    expect(r).toMatchObject({ ok: false, errores: { calle: "Indique la calle y el número." } });
  });
});

describe("normalizarCp", () => {
  it("mayúsculas y sin espacios", () => {
    expect(normalizarCp(" n3370 abc ")).toBe("N3370ABC");
    expect(normalizarCp("3370")).toBe("3370");
  });
});

describe("zona de envío", () => {
  it("dentro de la zona según envio.ts, con cualquier grafía", () => {
    expect(fueraDeZona({ ciudad: "Puerto Iguazú" })).toBe(false);
    expect(fueraDeZona({ ciudad: "eldorado" })).toBe(false);
    expect(fueraDeZona({ ciudad: "Rosario" })).toBe(true);
  });

  it("el aviso nombra la localidad y las ciudades con envío, en usted", () => {
    const aviso = avisoFueraDeZona("Rosario");
    expect(aviso).toContain("Rosario");
    expect(aviso).toContain("se coordina por separado");
    for (const c of CIUDADES_ENVIO) expect(aviso).toContain(c);
  });
});

describe("vista", () => {
  it("etiqueta por defecto cuando no tiene", () => {
    expect(etiquetaDireccion(guardada({ etiqueta: null }))).toBe("Dirección");
    expect(etiquetaDireccion(guardada())).toBe("Casa");
  });

  it("líneas para mostrar, sin huecos", () => {
    expect(lineasDireccion(guardada({ referencias: "Portón verde" }))).toEqual([
      "Av. Victoria Aguirre 100",
      "Puerto Iguazú, Misiones",
      "CP 3370",
      "Portón verde",
    ]);
    expect(lineasDireccion(guardada({ provincia: null, cp: null }))).toEqual([
      "Av. Victoria Aguirre 100",
      "Puerto Iguazú",
    ]);
  });

  it("opción del selector del checkout", () => {
    expect(opcionDireccion(guardada())).toBe("Casa: Av. Victoria Aguirre 100, Puerto Iguazú");
  });
});

describe("entrega desde una dirección guardada (checkout)", () => {
  it("la línea del pedido suma CP, provincia y referencias", () => {
    expect(lineaEntrega(guardada({ referencias: "Portón verde" }))).toBe(
      "Av. Victoria Aguirre 100, CP 3370, Misiones. Referencias: Portón verde",
    );
    expect(lineaEntrega(guardada({ cp: null, provincia: null }))).toBe("Av. Victoria Aguirre 100");
  });

  it("nunca pasa de los 200 caracteres que acepta el pedido", () => {
    const larga = guardada({ calle: "c".repeat(120), referencias: "r".repeat(200) });
    expect(lineaEntrega(larga).length).toBeLessThanOrEqual(200);
  });

  it("en zona manda la ciudad como la escribe envio.ts; fuera de zona, la guardada", () => {
    expect(entregaDesdeGuardada(guardada({ ciudad: "puerto iguazu" })).ciudad).toBe("Puerto Iguazú");
    expect(entregaDesdeGuardada(guardada({ ciudad: "Rosario" })).ciudad).toBe("Rosario");
    expect(entregaDesdeGuardada(guardada()).direccion).toBe(lineaEntrega(guardada()));
  });
});

describe("esIdDireccion", () => {
  it("sólo uuid (lo demás es 404 sin consultar la base)", () => {
    expect(esIdDireccion("0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10")).toBe(true);
    expect(esIdDireccion("0B8F7D1E-7C55-4A38-9D0E-2C1F7F6B9A10")).toBe(true);
    expect(esIdDireccion("abc")).toBe(false);
    expect(esIdDireccion("1; drop table x")).toBe(false);
    expect(esIdDireccion("")).toBe(false);
  });
});
