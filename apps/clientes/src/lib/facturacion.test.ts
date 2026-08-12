import { describe, expect, it } from "vitest";
import {
  cuitValido,
  dniValido,
  formatearCuit,
  validarFacturacion,
  domicilioEnLinea,
} from "./facturacion";

/**
 * Los datos de facturación terminan en un comprobante de AFIP. Un error acá no
 * se descubre al guardar: se descubre cuando el comprobante rebota, o cuando el
 * cliente no puede computar el crédito fiscal.
 */

describe("cuitValido — dígito verificador (módulo 11)", () => {
  it("acepta el CUIT público de AFIP", () => {
    expect(cuitValido("33-69345023-9")).toBe(true);
    expect(cuitValido("33693450239")).toBe(true);
  });

  it("rechaza el mismo CUIT con un dígito cambiado", () => {
    expect(cuitValido("33-69345024-9")).toBe(false);
  });

  it("rechaza largos que no sean 11 dígitos", () => {
    expect(cuitValido("3369345023")).toBe(false);
    expect(cuitValido("336934502399")).toBe(false);
    expect(cuitValido("")).toBe(false);
  });

  it("rechaza el CUIT de todos ceros, que pasa el módulo 11 pero no existe", () => {
    expect(cuitValido("00000000000")).toBe(false);
  });

  it("ignora guiones, puntos y espacios", () => {
    expect(cuitValido("33.69345023.9")).toBe(true);
    expect(cuitValido(" 33 69345023 9 ")).toBe(true);
  });

  /**
   * La propiedad que define al algoritmo: para cualquier prefijo de 10 dígitos
   * existe EXACTAMENTE un dígito verificador válido. Si alguien toca los pesos o
   * el manejo del resto, esto da 0 o 2 y el test cae — cosa que una lista de
   * CUITs de ejemplo no necesariamente detectaría.
   */
  it("para cualquier prefijo hay exactamente un verificador válido", () => {
    for (let n = 0; n < 200; n++) {
      const prefijo = String(n * 49999999 + 12345678).slice(0, 10).padStart(10, "1");
      const validos = "0123456789"
        .split("")
        .filter((d) => cuitValido(prefijo + d));
      expect(validos, `prefijo ${prefijo}`).toHaveLength(1);
    }
  });
});

describe("dniValido", () => {
  it("acepta 7 y 8 dígitos", () => {
    expect(dniValido("1234567")).toBe(true);
    expect(dniValido("12345678")).toBe(true);
  });

  it("rechaza fuera de rango y todos ceros", () => {
    expect(dniValido("123456")).toBe(false);
    expect(dniValido("123456789")).toBe(false);
    expect(dniValido("00000000")).toBe(false);
  });
});

describe("formatearCuit", () => {
  it("formatea un CUIT de 11 dígitos", () => {
    expect(formatearCuit("33693450239")).toBe("33-69345023-9");
  });

  it("devuelve la entrada tal cual si no son 11 dígitos", () => {
    expect(formatearCuit("123")).toBe("123");
  });
});

describe("validarFacturacion", () => {
  const completo = {
    razonSocial: "ACME SRL",
    domicilioCalle: "Av. Victoria Aguirre 500",
    domicilioCiudad: "Puerto Iguazú",
  };

  it("acepta un responsable inscripto con CUIT válido", () => {
    expect(
      validarFacturacion({
        ...completo,
        condicionIva: "responsable_inscripto",
        tipoDoc: "CUIT",
        nroDoc: "33-69345023-9",
      }),
    ).toEqual({});
  });

  it("acepta un consumidor final con DNI", () => {
    expect(
      validarFacturacion({
        ...completo,
        condicionIva: "consumidor_final",
        tipoDoc: "DNI",
        nroDoc: "12345678",
      }),
    ).toEqual({});
  });

  it("exige CUIT a monotributo y responsable inscripto", () => {
    for (const condicion of ["monotributo", "responsable_inscripto"] as const) {
      const errores = validarFacturacion({
        ...completo,
        condicionIva: condicion,
        tipoDoc: "DNI",
        nroDoc: "12345678",
      });
      expect(errores.tipoDoc, condicion).toBeTruthy();
    }
  });

  it("pide el domicilio a todos, no solo a quien discrimina IVA", () => {
    const errores = validarFacturacion({
      razonSocial: "Juan Pérez",
      condicionIva: "consumidor_final",
      tipoDoc: "DNI",
      nroDoc: "12345678",
    });
    expect(errores.domicilioCalle).toBeTruthy();
    expect(errores.domicilioCiudad).toBeTruthy();
  });

  it("pide la condición frente al IVA", () => {
    const errores = validarFacturacion({ ...completo, tipoDoc: "DNI", nroDoc: "12345678" });
    expect(errores.condicionIva).toBeTruthy();
  });

  /**
   * REGRESIÓN. La validación del número colgaba de la misma cadena `else if`
   * que el error de tipo de documento, así que con `tipoDoc` sin definir no
   * entraba en ninguna rama y un documento "123" salía sin un solo error.
   *
   * La firma recibe un `Partial<DatosFacturacion>`, o sea que ese caso es
   * exactamente lo que invita a pasarle. Sin tipoDoc debe validar como CUIT,
   * que es el default del servidor y el criterio más estricto.
   */
  it("valida el número aunque no venga tipoDoc", () => {
    const errores = validarFacturacion({
      ...completo,
      condicionIva: "consumidor_final",
      nroDoc: "123",
    });
    expect(errores.nroDoc).toBeTruthy();
  });

  /**
   * REGRESIÓN, mismo origen: con el tipo de documento mal elegido, el número
   * tampoco se miraba. Los dos errores tienen que aparecer juntos.
   */
  it("marca tipo y número cuando los dos están mal", () => {
    const errores = validarFacturacion({
      ...completo,
      condicionIva: "responsable_inscripto",
      tipoDoc: "DNI",
      nroDoc: "999",
    });
    expect(errores.tipoDoc).toBeTruthy();
    expect(errores.nroDoc).toBeTruthy();
  });

  it("rechaza un CUIT con el verificador mal", () => {
    const errores = validarFacturacion({
      ...completo,
      condicionIva: "responsable_inscripto",
      tipoDoc: "CUIT",
      nroDoc: "33-69345024-9",
    });
    expect(errores.nroDoc).toBeTruthy();
  });
});

describe("domicilioEnLinea", () => {
  it("arma el domicilio salteando lo que falta", () => {
    expect(
      domicilioEnLinea({
        domicilioCalle: "Av. Victoria Aguirre 500",
        domicilioCiudad: "Puerto Iguazú",
        domicilioProvincia: null,
        domicilioCp: "3370",
      }),
    ).toBe("Av. Victoria Aguirre 500, Puerto Iguazú, CP 3370");
  });

  it("devuelve vacío cuando no hay nada", () => {
    expect(domicilioEnLinea({})).toBe("");
  });
});
