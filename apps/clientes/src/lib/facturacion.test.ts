import { describe, expect, it } from "vitest";
import {
  admiteEnvio,
  ciParaguayValida,
  cnpjValido,
  cpfValido,
  formatearDocAlEscribir,
  normalizarDoc,
  rucParaguayValido,
  cuitValido,
  documentoEnLinea,
  dniValido,
  formatearCuit,
  telefonoValido,
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

describe("telefonoValido", () => {
  it("acepta entre 8 y 15 dígitos, con la puntuación con la que se escribe", () => {
    expect(telefonoValido("+54 376 4000000")).toBe(true);
    expect(telefonoValido("(0376) 15-400-0000")).toBe(true);
    expect(telefonoValido("40000000")).toBe(true);
    expect(telefonoValido("+55 (11) 91234-5678")).toBe(true);
  });

  it("rechaza lo que no llega a teléfono o se pasa", () => {
    expect(telefonoValido("")).toBe(false);
    expect(telefonoValido("123")).toBe(false);
    expect(telefonoValido("4000000")).toBe(false);
    expect(telefonoValido("1234567890123456")).toBe(false);
    expect(telefonoValido("sin números")).toBe(false);
  });
});

describe("validarFacturacion — teléfono", () => {
  const base = {
    pais: "AR" as const,
    tipoDoc: "DNI" as const,
    nroDoc: "27123456",
    razonSocial: "Ana",
    condicionIva: "consumidor_final" as const,
    domicilioCalle: "Calle 1",
    domicilioCiudad: "Ciudad",
  };

  it("es opcional: vacío o ausente no da error", () => {
    expect(validarFacturacion(base)).toEqual({});
    expect(validarFacturacion({ ...base, telefono: "  " })).toEqual({});
  });

  it("si viene, tiene que parecer un teléfono", () => {
    expect(validarFacturacion({ ...base, telefono: "+54 376 4000000" })).toEqual({});
    expect(validarFacturacion({ ...base, telefono: "123" })).toHaveProperty("telefono");
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

describe("formatearDocAlEscribir", () => {
  it("CUIT: pone los guiones a medida que se escribe", () => {
    expect(formatearDocAlEscribir("CUIT", "2")).toBe("2");
    expect(formatearDocAlEscribir("CUIT", "203")).toBe("20-3");
    expect(formatearDocAlEscribir("CUIT", "2012345678")).toBe("20-12345678");
    expect(formatearDocAlEscribir("CUIT", "20123456789")).toBe("20-12345678-9");
  });

  it("no pone el separador hasta que hay algo después: borrar hacia atrás no se traba", () => {
    expect(formatearDocAlEscribir("CUIT", "20")).toBe("20");
    expect(formatearDocAlEscribir("CUIT", "20-")).toBe("20");
    expect(formatearDocAlEscribir("CUIT", "20-12345678-")).toBe("20-12345678");
  });

  it("acepta un número pegado con o sin guiones, y descarta lo que sobra", () => {
    expect(formatearDocAlEscribir("CUIT", "33-69345023-9")).toBe("33-69345023-9");
    expect(formatearDocAlEscribir("CUIT", "33693450239")).toBe("33-69345023-9");
    expect(formatearDocAlEscribir("CUIT", "336934502399999")).toBe("33-69345023-9");
    expect(formatearDocAlEscribir("CUIT", "33 693.450/23 9")).toBe("33-69345023-9");
  });

  it("CPF y CNPJ, incluido el CNPJ alfanumérico", () => {
    expect(formatearDocAlEscribir("CPF", "52998224725")).toBe("529.982.247-25");
    expect(formatearDocAlEscribir("CPF", "5299")).toBe("529.9");
    expect(formatearDocAlEscribir("CNPJ", "11222333000181")).toBe("11.222.333/0001-81");
    expect(formatearDocAlEscribir("CNPJ", "12abc34501de35")).toBe("12.ABC.345/01DE-35");
  });

  it("DNI y cédula: solo dígitos, sin separadores", () => {
    expect(formatearDocAlEscribir("DNI", "27.123.456")).toBe("27123456");
    expect(formatearDocAlEscribir("DNI", "271234569")).toBe("27123456");
    expect(formatearDocAlEscribir("CI", "4.123.456")).toBe("4123456");
  });

  it("RUC: el guion va recién al salir del campo, porque el largo del número varía", () => {
    expect(formatearDocAlEscribir("RUC", "800005198")).toBe("800005198");
    expect(formatearDocAlEscribir("RUC", "800005198", { alSalir: true })).toBe("80000519-8");
    expect(formatearDocAlEscribir("RUC", "80000519-8")).toBe("800005198");
    expect(formatearDocAlEscribir("RUC", "1234", { alSalir: true })).toBe("1234");
  });

  it("lo que produce siempre valida igual que el número pelado", () => {
    expect(cuitValido(formatearDocAlEscribir("CUIT", "33693450239"))).toBe(true);
    expect(cpfValido(formatearDocAlEscribir("CPF", "52998224725"))).toBe(true);
    expect(cnpjValido(formatearDocAlEscribir("CNPJ", "12ABC34501DE35"))).toBe(true);
    expect(rucParaguayValido(formatearDocAlEscribir("RUC", "800005198", { alSalir: true }))).toBe(true);
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

describe("documentoEnLinea", () => {
  it("rotula CUIT sólo con 11 dígitos", () => {
    expect(documentoEnLinea("33693450239")).toBe("CUIT 33-69345023-9");
    expect(documentoEnLinea("39282165")).toBe("documento 39282165");
  });
});
