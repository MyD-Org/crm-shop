import { describe, expect, it } from "vitest";
import {
  armarPutSoloVacios,
  condicionAAlegra,
  condicionDeAlegra,
  congelarFacturacion,
  contactoDeAlegra,
  hayTelefonoParaPedido,
  telefonoDelCheckout,
  telefonoParaAlegra,
  telefonosParaMostrar,
  telefonoPreferido,
  telefonosDelContacto,
  deducirTipoDoc,
  estadoFacturacionCheckout,
  leerContacto,
  mezclarConPerfil,
  validarComplemento,
  type ContactoFacturacion,
} from "./contacto-alegra";

/**
 * Lógica pura del change `contacto-fuente-unica`: cómo se leen los datos de
 * facturación de un contacto de Alegra (espejo o en vivo), qué falta, qué
 * puede completar el Shop (sólo vacíos: D1) y qué cuerpo va en el PUT.
 *
 * Datos inventados. CUITs con verificador válido calculado a mano:
 * 30-71234567-1 (empresa), 20-12345678-6 (persona), 33-69345023-9 (el público
 * de AFIP).
 */

const CUIT_EMPRESA = "30712345671";
const CUIT_PERSONA = "20123456786";

function fila(over: Partial<ContactoFacturacion> = {}): ContactoFacturacion {
  return {
    alegraId: "42",
    name: "ACME SRL",
    identification: "30-71234567-1",
    identificationNorm: CUIT_EMPRESA,
    identificationType: "CUIT",
    identificationNumber: "30-71234567-1",
    ivaCondition: "IVA_RESPONSABLE",
    addressStreet: "Calle Falsa 123",
    addressCity: "Posadas",
    addressProvince: null,
    addressPostalCode: null,
    ...over,
  };
}

/** Un documento: número (con o sin formato) y su norma. */
const doc = (numero: string | null, tipo: string | null = null) => ({
  identification: numero,
  identificationNumber: numero,
  identificationNorm: numero ? numero.replace(/\D/g, "") || null : null,
  identificationType: tipo,
});

describe("mapeo de condición de IVA Alegra ↔ Shop", () => {
  it("los cuatro valores de Alegra", () => {
    expect(condicionDeAlegra("FINAL_CONSUMER")).toBe("consumidor_final");
    expect(condicionDeAlegra("IVA_RESPONSABLE")).toBe("responsable_inscripto");
    expect(condicionDeAlegra("UNIQUE_TRIBUTE_RESPONSABLE")).toBe("monotributo");
    expect(condicionDeAlegra("IVA_EXEMPT")).toBe("exento");
    expect(condicionDeAlegra(null)).toBeNull();
    expect(condicionDeAlegra("OTRO_VALOR")).toBeNull();
  });

  it("inverso, incluido exento", () => {
    expect(condicionAAlegra("consumidor_final")).toBe("FINAL_CONSUMER");
    expect(condicionAAlegra("responsable_inscripto")).toBe("IVA_RESPONSABLE");
    expect(condicionAAlegra("monotributo")).toBe("UNIQUE_TRIBUTE_RESPONSABLE");
    expect(condicionAAlegra("exento")).toBe("IVA_EXEMPT");
  });

  it("condición NULL ⇒ faltante", () => {
    const l = leerContacto(fila({ ivaCondition: null }));
    expect(l.faltantes).toContain("condicionIva");
    expect(l.motivoRevision).toBeNull();
  });

  it("valor desconocido ⇒ presente, se conserva tal cual y marca revisión", () => {
    const l = leerContacto(fila({ ivaCondition: "OTRO_VALOR" }));
    expect(l.faltantes).not.toContain("condicionIva");
    expect(l.bloqueados).toContain("condicionIva");
    expect(l.datos.condicionIva).toBeUndefined();
    expect(l.datos.condicionIvaAlegra).toBe("OTRO_VALOR");
    expect(l.motivoRevision).toBe("condicion_iva_desconocida");
    expect(l.completo).toBe(true);
  });

  it("exento con CUIT válido: completo, sin faltante de condición", () => {
    const l = leerContacto(fila({ ivaCondition: "IVA_EXEMPT" }));
    expect(l.datos.condicionIva).toBe("exento");
    expect(l.completo).toBe(true);
    expect(l.motivoRevision).toBeNull();
  });
});

describe("tipo de documento (R4-bis)", () => {
  it("CUIT y DNI de Alegra se usan tal cual", () => {
    expect(leerContacto(fila()).datos.tipoDoc).toBe("CUIT");
    const dni = leerContacto(fila({ ...doc("12345678", "DNI"), ivaCondition: "FINAL_CONSUMER" }));
    expect(dni.datos.tipoDoc).toBe("DNI");
    expect(dni.tipoDocDeducido).toBe(false);
  });

  it("condición que exige CUIT + tipo vacío + 11 dígitos válidos ⇒ CUIT (los 99 '+N' de prod)", () => {
    for (const iva of ["IVA_RESPONSABLE", "UNIQUE_TRIBUTE_RESPONSABLE", "IVA_EXEMPT"]) {
      const l = leerContacto(fila({ ...doc("20-12345678-6"), ivaCondition: iva }));
      expect(l.datos.tipoDoc, iva).toBe("CUIT");
      expect(l.tipoDocDeducido).toBe(true);
      expect(l.motivoRevision).toBeNull();
      expect(l.faltantes).toEqual([]);
    }
  });

  it("consumidor final con 11 dígitos: 30/33/34 ⇒ CUIT; 20/23/24/27 ⇒ CUIL; otro prefijo ⇒ tipo faltante", () => {
    const cf = (numero: string) => leerContacto(fila({ ...doc(numero), ivaCondition: "FINAL_CONSUMER" }));
    expect(cf("30-71234567-1").datos.tipoDoc).toBe("CUIT");
    expect(cf("33-69345023-9").datos.tipoDoc).toBe("CUIT");
    expect(cf("20-12345678-6").datos.tipoDoc).toBe("CUIL");
    expect(cf("27123456780").datos.tipoDoc).toBe("CUIL");
    const otro = cf("55123456789");
    expect(otro.datos.tipoDoc).toBeUndefined();
    expect(otro.faltantes).toEqual(["tipoDoc"]);
  });

  it("condición NULL: se aplica la regla de consumidor final", () => {
    const l = leerContacto(fila({ ...doc("20-12345678-6"), ivaCondition: null }));
    expect(l.datos.tipoDoc).toBe("CUIL");
    expect(l.faltantes).toEqual(["condicionIva"]);
  });

  it("7–8 dígitos ⇒ DNI", () => {
    expect(deducirTipoDoc({ condicion: "consumidor_final", numero: "12.345.678" })).toEqual({
      tipo: "DNI",
      incompatible: false,
    });
    expect(deducirTipoDoc({ condicion: null, numero: "1234567" }).tipo).toBe("DNI");
  });

  it("número no interpretable ('123') ⇒ tipo faltante y el número no se toca", () => {
    const l = leerContacto(fila({ ...doc("123"), ivaCondition: "FINAL_CONSUMER" }));
    expect(l.faltantes).toEqual(["tipoDoc"]);
    expect(l.datos.nroDoc).toBe("123");
    expect(l.bloqueados).toContain("nroDoc");
  });

  it("número vacío ⇒ tipo y número faltantes", () => {
    const l = leerContacto(fila({ ...doc(null), ivaCondition: "FINAL_CONSUMER" }));
    expect(l.faltantes).toEqual(["tipoDoc", "nroDoc"]);
  });

  it("el vinculado siempre es argentino", () => {
    expect(leerContacto(fila()).datos.pais).toBe("AR");
  });
});

describe("documento incompatible (R5)", () => {
  const exigen = ["IVA_RESPONSABLE", "UNIQUE_TRIBUTE_RESPONSABLE", "IVA_EXEMPT"];
  const casos: [string, string | null][] = [
    ["12345678", "DNI"],
    ["12345678", null],
    ["123456789", null],
    ["201234567861", null],
    ["20123456785", null], // verificador inválido, tipo vacío
    ["20123456785", "CUIT"], // verificador inválido, tipo CUIT
    ["123", null],
    ["12345", null],
  ];

  for (const iva of exigen) {
    for (const [numero, tipo] of casos) {
      it(`${iva} + ${numero} (${tipo ?? "sin tipo"}) ⇒ completo y marcado para revisión`, () => {
        const l = leerContacto(fila({ ...doc(numero, tipo), ivaCondition: iva }));
        expect(l.completo).toBe(true);
        expect(l.faltantes).toEqual([]);
        expect(l.motivoRevision).toBe("documento_incompatible");
        expect(l.datos.nroDoc).toBe(numero);
        expect(l.datos.tipoDoc).toBeDefined();
      });
    }
  }

  it("el tipo congelado: el de Alegra; sin tipo, el que dan los dígitos o CUIT", () => {
    expect(leerContacto(fila({ ...doc("12345678", "DNI") })).datos.tipoDoc).toBe("DNI");
    expect(leerContacto(fila({ ...doc("12345678") })).datos.tipoDoc).toBe("DNI");
    expect(leerContacto(fila({ ...doc("123456789") })).datos.tipoDoc).toBe("CUIT");
  });

  it("contraste: misma condición con documento vacío ⇒ faltan tipo y número, sin motivo", () => {
    const l = leerContacto(fila({ ...doc(null), ivaCondition: "IVA_RESPONSABLE" }));
    expect(l.faltantes).toEqual(["tipoDoc", "nroDoc"]);
    expect(l.motivoRevision).toBeNull();
  });
});

describe("faltantes y bloqueados del domicilio", () => {
  it("sin calle ⇒ faltantes = [domicilioCalle]", () => {
    const l = leerContacto(fila({ addressStreet: null }));
    expect(l.faltantes).toEqual(["domicilioCalle"]);
    expect(l.completo).toBe(false);
    expect(l.bloqueados).toContain("domicilioCiudad");
  });

  it("sin provincia ni CP ⇒ completo (nunca son faltantes)", () => {
    const l = leerContacto(fila({ addressProvince: null, addressPostalCode: null }));
    expect(l.completo).toBe(true);
    expect(l.bloqueados).not.toContain("domicilioProvincia");
  });

  it("el contacto en vivo se mapea igual que la fila del espejo", () => {
    const vivo = contactoDeAlegra({
      id: 42,
      name: "ACME SRL",
      identification: "30-71234567-1",
      identificationObject: { type: "CUIT", number: "30-71234567-1" },
      ivaCondition: "IVA_RESPONSABLE",
      address: { address: "Calle Falsa 123", city: "Posadas", province: "  ", postalCode: "" },
    });
    expect(vivo).toEqual({ ...fila(), phonePrimary: null, phoneSecondary: null, mobile: null });
    expect(contactoDeAlegra({ id: "7", name: "X", address: "texto suelto" })).toMatchObject({
      alegraId: "7",
      addressStreet: null,
      identificationNorm: null,
      ivaCondition: null,
    });
  });
});

describe("mezcla con el perfil sólo con el mismo documento (D2)", () => {
  const perfil = {
    pais: "AR",
    tipoDoc: "CUIT",
    nroDoc: CUIT_EMPRESA,
    razonSocial: "Otra razón",
    condicionIva: "consumidor_final",
    domicilioCalle: "Av. Siempreviva 742",
    domicilioCiudad: "Oberá",
    domicilioProvincia: "Misiones",
    domicilioCp: "3360",
  };

  it("mismo documento: completa la calle y marca que aportó", () => {
    const { lectura, aporto } = mezclarConPerfil(leerContacto(fila({ addressStreet: null })), perfil);
    expect(lectura.datos.domicilioCalle).toBe("Av. Siempreviva 742");
    expect(lectura.completo).toBe(true);
    expect(aporto).toContain("domicilioCalle");
    // nunca pisa lo presente
    expect(lectura.datos.razonSocial).toBe("ACME SRL");
    expect(lectura.datos.domicilioCiudad).toBe("Posadas");
  });

  it("documento distinto: no mezcla", () => {
    const { lectura, aporto } = mezclarConPerfil(leerContacto(fila({ addressStreet: null })), {
      ...perfil,
      nroDoc: "33693450239",
    });
    expect(aporto).toEqual([]);
    expect(lectura.faltantes).toEqual(["domicilioCalle"]);
  });

  it("el RI del espejo gana al consumidor final del perfil", () => {
    const { lectura } = mezclarConPerfil(leerContacto(fila()), perfil);
    expect(lectura.datos.condicionIva).toBe("responsable_inscripto");
  });

  it("espejo sin número: no hay con qué comparar, no mezcla", () => {
    const { aporto } = mezclarConPerfil(leerContacto(fila({ ...doc(null), addressStreet: null })), perfil);
    expect(aporto).toEqual([]);
  });

  it("perfil extranjero o sin documento: no mezcla", () => {
    expect(mezclarConPerfil(leerContacto(fila({ addressStreet: null })), { ...perfil, pais: "BR" }).aporto).toEqual([]);
    expect(mezclarConPerfil(leerContacto(fila({ addressStreet: null })), { ...perfil, nroDoc: null }).aporto).toEqual(
      [],
    );
  });

  it("condición del perfil sobre una CUIL deducida: el tipo se vuelve a deducir (RI ⇒ CUIT)", () => {
    const l = leerContacto(fila({ ...doc("20-12345678-6"), ivaCondition: null }));
    expect(l.datos.tipoDoc).toBe("CUIL");
    const { lectura } = mezclarConPerfil(l, { ...perfil, nroDoc: CUIT_PERSONA, condicionIva: "monotributo" });
    expect(lectura.datos.condicionIva).toBe("monotributo");
    expect(lectura.datos.tipoDoc).toBe("CUIT");
    expect(lectura.completo).toBe(true);
  });
});

describe("validarComplemento (D1 en servidor)", () => {
  it("rechaza un campo presente con otro valor (campo_de_alegra)", () => {
    const r = validarComplemento(leerContacto(fila({ addressStreet: null })), {
      razonSocial: "Otra SRL",
      domicilioCalle: "Nueva 1",
    });
    expect(r).toEqual({ ok: false, motivo: "campo_de_alegra", campos: ["razonSocial"] });
  });

  it("acepta un presente con el mismo valor y sólo cuenta el vacío", () => {
    const r = validarComplemento(leerContacto(fila({ addressStreet: null })), {
      razonSocial: " acme srl ",
      domicilioCalle: "Nueva 1",
      nroDoc: "30-71234567-1",
    });
    expect(r).toMatchObject({ ok: true, complemento: { domicilioCalle: "Nueva 1" } });
    if (r.ok) expect(Object.keys(r.complemento)).toEqual(["domicilioCalle"]);
  });

  it("exige todos los faltantes requeridos (R9): sin condición no hay PUT", () => {
    const r = validarComplemento(leerContacto(fila({ ivaCondition: null, addressStreet: null })), {
      domicilioCalle: "Nueva 1",
    });
    expect(r).toMatchObject({ ok: false, motivo: "invalido" });
    if (!r.ok && r.motivo === "invalido") expect(r.errores.condicionIva).toBe("Elija su condición frente al IVA.");
  });

  it("CUIT tipeado inválido ⇒ 'Ingrese un CUIT válido.'", () => {
    const r = validarComplemento(leerContacto(fila({ ...doc(null), ivaCondition: "FINAL_CONSUMER" })), {
      tipoDoc: "CUIT",
      nroDoc: "20-12345678-5",
    });
    expect(r).toMatchObject({ ok: false, motivo: "invalido", errores: { nroDoc: "Ingrese un CUIT válido." } });
  });

  it("condición que exige CUIT con documento vacío (0 dígitos): el tipeado tiene que ser CUIT", () => {
    const l = leerContacto(fila({ ...doc(null), ivaCondition: "IVA_EXEMPT" }));
    const conDni = validarComplemento(l, { tipoDoc: "DNI", nroDoc: "12345678" });
    expect(conDni).toMatchObject({ ok: false, motivo: "invalido" });
    if (!conDni.ok && conDni.motivo === "invalido") expect(conDni.errores.tipoDoc).toMatch(/exige CUIT/);
    expect(validarComplemento(l, { tipoDoc: "CUIT", nroDoc: "30-71234567-1" })).toMatchObject({ ok: true });
  });

  it("condición tipeada que exige CUIT sobre un DNI de la cuenta ⇒ error en la condición", () => {
    const l = leerContacto(fila({ ...doc("12345678", "DNI"), ivaCondition: null }));
    const r = validarComplemento(l, { condicionIva: "responsable_inscripto" });
    expect(r).toMatchObject({ ok: false, motivo: "invalido" });
    if (!r.ok && r.motivo === "invalido") expect(r.errores.condicionIva).toMatch(/exige CUIT/);
    expect(validarComplemento(l, { condicionIva: "consumidor_final" })).toMatchObject({ ok: true });
  });

  it("condición tipeada sobre una CUIL deducida válida: RI la vuelve CUIT", () => {
    const l = leerContacto(fila({ ...doc("20-12345678-6"), ivaCondition: null }));
    const r = validarComplemento(l, { condicionIva: "responsable_inscripto" });
    expect(r).toMatchObject({ ok: true, datos: { tipoDoc: "CUIT", condicionIva: "responsable_inscripto" } });
  });

  it("provincia: opcional, de la lista, se guarda con el nombre oficial", () => {
    const l = leerContacto(fila({ addressStreet: null }));
    expect(validarComplemento(l, { domicilioCalle: "Nueva 1", domicilioProvincia: "caba" })).toMatchObject({
      ok: true,
      complemento: { domicilioProvincia: "Ciudad Autónoma de Buenos Aires" },
    });
    const mal = validarComplemento(l, { domicilioCalle: "Nueva 1", domicilioProvincia: "Narnia" });
    expect(mal).toMatchObject({
      ok: false,
      motivo: "invalido",
      errores: { domicilioProvincia: "Seleccione una provincia de la lista." },
    });
  });

  it("un campo que no falta ni es opcional vacío se ignora", () => {
    const r = validarComplemento(leerContacto(fila({ addressStreet: null, addressPostalCode: "3300" })), {
      domicilioCalle: "Nueva 1",
      domicilioCp: "3300",
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.complemento).toEqual({ domicilioCalle: "Nueva 1" });
  });
});

describe("armarPutSoloVacios (D-7)", () => {
  it("falta sólo la calle: name/ivaCondition/identificationObject del espejo y address completo sin nulls", () => {
    const base = fila({ addressStreet: null });
    const l = leerContacto(base);
    const r = validarComplemento(l, { domicilioCalle: "Nueva 1" });
    if (!r.ok) throw new Error("debería validar");
    expect(armarPutSoloVacios(base, r.datos, r.complemento)).toEqual({
      name: "ACME SRL",
      ivaCondition: "IVA_RESPONSABLE",
      identificationObject: { type: "CUIT", number: "30-71234567-1" },
      address: { address: "Nueva 1", city: "Posadas" },
    });
  });

  it("condición vacía: va la cargada, mapeada a Alegra; sin domicilio no hay address", () => {
    const base = fila({ ivaCondition: null });
    const r = validarComplemento(leerContacto(base), { condicionIva: "exento" });
    if (!r.ok) throw new Error("debería validar");
    const body = armarPutSoloVacios(base, r.datos, r.complemento);
    expect(body.ivaCondition).toBe("IVA_EXEMPT");
    expect(body).not.toHaveProperty("address");
  });

  it("tipo vacío en Alegra: se escribe el deducido (llena un vacío) con el número del espejo", () => {
    const base = fila({ ...doc("20-12345678-6"), ivaCondition: "FINAL_CONSUMER", addressStreet: null });
    const r = validarComplemento(leerContacto(base), { domicilioCalle: "Nueva 1" });
    if (!r.ok) throw new Error("debería validar");
    expect(armarPutSoloVacios(base, r.datos, r.complemento).identificationObject).toEqual({
      type: "CUIL",
      number: "20-12345678-6",
    });
    // Si Alegra no aceptara CUIL: no se escribe el tipo (queda vacío, como estaba).
    expect(
      armarPutSoloVacios(base, r.datos, r.complemento, { escribirCuil: false }).identificationObject,
    ).toEqual({ type: "", number: "20-12345678-6" });
  });

  it("documento vacío: tipo y número del complemento", () => {
    const base = fila({ ...doc(null), ivaCondition: "FINAL_CONSUMER" });
    const r = validarComplemento(leerContacto(base), { tipoDoc: "DNI", nroDoc: "12.345.678" });
    if (!r.ok) throw new Error("debería validar");
    expect(armarPutSoloVacios(base, r.datos, r.complemento).identificationObject).toEqual({
      type: "DNI",
      number: "12345678",
    });
  });

  it("nunca manda un valor distinto de uno presente", () => {
    const base = fila({ addressStreet: null, addressProvince: "Misiones" });
    const l = leerContacto(base);
    expect(validarComplemento(l, { domicilioCalle: "Nueva 1", domicilioProvincia: "Salta" })).toMatchObject({
      ok: false,
      motivo: "campo_de_alegra",
      campos: ["domicilioProvincia"],
    });
    // Aunque le llegara un complemento así, el cuerpo reenvía lo del espejo.
    const complemento = { domicilioCalle: "Nueva 1", domicilioProvincia: "Salta" };
    expect(armarPutSoloVacios(base, l.datos, complemento).address).toEqual({
      address: "Nueva 1",
      city: "Posadas",
      province: "Misiones",
    });
  });
});

describe("congelado del pedido y estado del checkout", () => {
  it("congela la condición real (exento) o el valor de Alegra si no mapea", () => {
    expect(congelarFacturacion(leerContacto(fila({ ivaCondition: "IVA_EXEMPT" })).datos)).toMatchObject({
      tipoDoc: "CUIT",
      nroDoc: CUIT_EMPRESA,
      razonSocial: "ACME SRL",
      condicionIva: "exento",
      domicilio: "Calle Falsa 123, Posadas",
    });
    expect(congelarFacturacion(leerContacto(fila({ ivaCondition: "OTRO_VALOR" })).datos)?.condicionIva).toBe(
      "OTRO_VALOR",
    );
    expect(congelarFacturacion(leerContacto(fila({ ...doc(null) })).datos)).toBeNull();
  });

  it("estadoFacturacionCheckout", () => {
    expect(estadoFacturacionCheckout({ completo: true, fuente: "espejo", complemento: null })).toEqual({
      puedeConfirmar: true,
      aviso: null,
    });
    expect(estadoFacturacionCheckout({ completo: false, fuente: "espejo", complemento: null })).toEqual({
      puedeConfirmar: false,
      aviso: "faltan_datos",
    });
    expect(
      estadoFacturacionCheckout({ completo: false, fuente: "espejo", complemento: { domicilioCalle: "X 1" } }),
    ).toEqual({ puedeConfirmar: true, aviso: null });
    expect(estadoFacturacionCheckout({ completo: false, fuente: "no_disponible", complemento: null })).toEqual({
      puedeConfirmar: false,
      aviso: "no_disponible",
    });
  });
});

describe("teléfono del contacto (0036 del CRM)", () => {
  it("contactoDeAlegra lee los tres teléfonos; vacío o espacios ⇒ null", () => {
    expect(
      contactoDeAlegra({ id: "7", name: "X", phonePrimary: " 011 4000-0000 ", phoneSecondary: "  ", mobile: "" }),
    ).toMatchObject({ phonePrimary: "011 4000-0000", phoneSecondary: null, mobile: null });
  });

  it("preferido: celular > principal > secundario; ninguno ⇒ null", () => {
    expect(telefonoPreferido({ mobile: "11 5000-0000", phonePrimary: "011 4000-0000", phoneSecondary: "x" })).toBe(
      "11 5000-0000",
    );
    expect(telefonoPreferido({ mobile: " ", phonePrimary: "011 4000-0000", phoneSecondary: "x" })).toBe("011 4000-0000");
    expect(telefonoPreferido({ mobile: null, phonePrimary: null, phoneSecondary: "011 4000-0001" })).toBe(
      "011 4000-0001",
    );
    expect(telefonoPreferido({})).toBeNull();
  });

  it("telefonosDelContacto normaliza ausentes a null", () => {
    expect(telefonosDelContacto({ phonePrimary: "011 4000-0000" })).toEqual({
      mobile: null,
      phonePrimary: "011 4000-0000",
      phoneSecondary: null,
    });
  });

  it("telefonoParaAlegra: recorta y exige 8 a 15 dígitos", () => {
    expect(telefonoParaAlegra("  +54 376 4000000  ")).toBe("+54 376 4000000");
    expect(telefonoParaAlegra("123")).toBeNull();
    expect(telefonoParaAlegra("llamar a la tarde")).toBeNull();
    expect(telefonoParaAlegra("")).toBeNull();
    expect(telefonoParaAlegra(null)).toBeNull();
  });
});

describe("teléfono en el checkout", () => {
  it("vinculado con teléfono en Alegra: se precarga y es de su cuenta", () => {
    expect(telefonoDelCheckout({ telefonoAlegra: "11 5000-0000", telefonoPerfil: "3764000000" })).toEqual({
      inicial: "11 5000-0000",
      deSuCuenta: true,
    });
  });

  it("sin teléfono en Alegra: el del perfil (como siempre), o vacío", () => {
    expect(telefonoDelCheckout({ telefonoAlegra: null, telefonoPerfil: "3764000000" })).toEqual({
      inicial: "3764000000",
      deSuCuenta: false,
    });
    expect(telefonoDelCheckout({ telefonoAlegra: " ", telefonoPerfil: null })).toEqual({ inicial: "", deSuCuenta: false });
  });

  it("confirmar: alcanza con el de Alegra aunque el campo quede vacío", () => {
    expect(hayTelefonoParaPedido("", "11 5000-0000")).toBe(true);
    expect(hayTelefonoParaPedido("  ", null)).toBe(false);
    expect(hayTelefonoParaPedido("3764000000", null)).toBe(true);
  });
});

describe("teléfonos de Alegra en Mis datos", () => {
  it("sólo los cargados, en orden de uso, con etiqueta", () => {
    expect(telefonosParaMostrar({ mobile: "11 5000-0000", phonePrimary: null, phoneSecondary: "011 4000-0001" })).toEqual([
      { label: "Celular", valor: "11 5000-0000" },
      { label: "Teléfono alternativo", valor: "011 4000-0001" },
    ]);
  });

  it("ninguno o null ⇒ lista vacía (se muestra el editor de siempre)", () => {
    expect(telefonosParaMostrar({ mobile: null, phonePrimary: " ", phoneSecondary: null })).toEqual([]);
    expect(telefonosParaMostrar(null)).toEqual([]);
  });
});
