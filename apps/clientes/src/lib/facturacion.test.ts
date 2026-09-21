import { describe, expect, it } from "vitest";
import {
  admiteEnvio,
  ciParaguayValida,
  cnpjValido,
  cpfValido,
  normalizarDoc,
  rucParaguayValido,
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

describe("cpfValido — Brasil", () => {
  it("acepta un CPF con los dos verificadores bien, con o sin puntuación", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("52998224725")).toBe(true);
  });

  it("rechaza un verificador cambiado y largos incorrectos", () => {
    expect(cpfValido("529.982.247-26")).toBe(false);
    expect(cpfValido("5299822472")).toBe(false);
    expect(cpfValido("")).toBe(false);
  });

  it("rechaza las secuencias de un mismo dígito, que pasan la cuenta pero no existen", () => {
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("000.000.000-00")).toBe(false);
  });
});

describe("cnpjValido — Brasil", () => {
  it("acepta un CNPJ numérico", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
  });

  it("acepta el CNPJ alfanumérico de ejemplo de la Receita, en minúscula también", () => {
    expect(cnpjValido("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjValido("12abc34501de35")).toBe(true);
  });

  it("rechaza verificadores mal, letras en los verificadores y todos ceros", () => {
    expect(cnpjValido("11.222.333/0001-82")).toBe(false);
    expect(cnpjValido("12.ABC.345/01DE-3A")).toBe(false);
    expect(cnpjValido("00.000.000/0000-00")).toBe(false);
  });
});

describe("documentos de Paraguay", () => {
  it("RUC: acepta el verificador correcto y rechaza el resto", () => {
    expect(rucParaguayValido("80000519-8")).toBe(true);
    expect(rucParaguayValido("800005198")).toBe(true);
    expect(rucParaguayValido("80000519-7")).toBe(false);
    expect(rucParaguayValido("4000000-4")).toBe(false);
  });

  it("RUC: rechaza largos fuera de rango y todos ceros", () => {
    expect(rucParaguayValido("1234")).toBe(false);
    expect(rucParaguayValido("1234567890")).toBe(false);
    expect(rucParaguayValido("000000")).toBe(false);
  });

  it("CI: no tiene verificador, solo se mira el largo", () => {
    expect(ciParaguayValida("4.123.456")).toBe(true);
    expect(ciParaguayValida("12345")).toBe(true);
    expect(ciParaguayValida("1234")).toBe(false);
    expect(ciParaguayValida("123456789")).toBe(false);
    expect(ciParaguayValida("0000000")).toBe(false);
  });
});

describe("normalizarDoc", () => {
  it("deja solo dígitos, salvo en el CNPJ que conserva letras en mayúscula", () => {
    expect(normalizarDoc("CUIT", "33-69345023-9")).toBe("33693450239");
    expect(normalizarDoc("CPF", "529.982.247-25")).toBe("52998224725");
    expect(normalizarDoc("CNPJ", "12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });
});

describe("admiteEnvio", () => {
  it("solo Argentina, y un perfil sin país cuenta como Argentina", () => {
    expect(admiteEnvio("AR")).toBe(true);
    expect(admiteEnvio(null)).toBe(true);
    expect(admiteEnvio(undefined)).toBe(true);
    expect(admiteEnvio("BR")).toBe(false);
    expect(admiteEnvio("PY")).toBe(false);
  });
});

describe("validarFacturacion — por país", () => {
  const completo = {
    razonSocial: "Comercial Exemplo Ltda",
    domicilioCalle: "Av. Victoria Aguirre 500",
    domicilioCiudad: "Puerto Iguazú",
  };

  it("acepta los dos documentos de Brasil y los dos de Paraguay", () => {
    expect(validarFacturacion({ ...completo, pais: "BR", tipoDoc: "CPF", nroDoc: "529.982.247-25" })).toEqual({});
    expect(validarFacturacion({ ...completo, pais: "BR", tipoDoc: "CNPJ", nroDoc: "11.222.333/0001-81" })).toEqual({});
    expect(validarFacturacion({ ...completo, pais: "PY", tipoDoc: "RUC", nroDoc: "80000519-8" })).toEqual({});
    expect(validarFacturacion({ ...completo, pais: "PY", tipoDoc: "CI", nroDoc: "4123456" })).toEqual({});
  });

  it("a un extranjero no le pide la condición frente al IVA", () => {
    const errores = validarFacturacion({ ...completo, pais: "BR", tipoDoc: "CPF", nroDoc: "529.982.247-25" });
    expect(errores.condicionIva).toBeUndefined();
  });

  it("rechaza un documento que no es del país elegido, y valida el número igual", () => {
    const errores = validarFacturacion({
      ...completo,
      pais: "BR",
      tipoDoc: "CUIT",
      nroDoc: "33-69345023-9",
    });
    expect(errores.tipoDoc).toBeDefined();
    // Un CUIT válido no es un CNPJ válido: el número no pasa de largo.
    expect(errores.nroDoc).toBeDefined();
  });

  it("rechaza un CPF con el verificador mal", () => {
    const errores = validarFacturacion({ ...completo, pais: "BR", tipoDoc: "CPF", nroDoc: "529.982.247-26" });
    expect(errores.nroDoc).toContain("CPF");
  });

  it("rechaza un país desconocido", () => {
    const errores = validarFacturacion({
      ...completo,
      pais: "UY" as never,
      tipoDoc: "CUIT",
      nroDoc: "33-69345023-9",
      condicionIva: "consumidor_final",
    });
    expect(errores.pais).toBeDefined();
  });

  it("sin país se comporta como Argentina", () => {
    expect(
      validarFacturacion({
        ...completo,
        condicionIva: "consumidor_final",
        tipoDoc: "DNI",
        nroDoc: "27123456",
      }),
    ).toEqual({});
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
