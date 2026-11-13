import { describe, expect, it } from "vitest";
import {
  DATOS_INVITADO_VACIOS,
  camposDeInvitadoParaPedido,
  cuerpoFacturacionInvitado,
  erroresFacturacionInvitado,
  invitadoCompleto,
  validarContactoInvitado,
  type DatosInvitado,
} from "./invitado-form";
import { TEXTOS_INVITADO, ERRORES_INVITADO } from "./invitado-textos";

// Documentos de prueba válidos (DNI de 8 dígitos; CUIT con dígito verificador correcto).
const DNI = "30123456";
const CUIT = "20123456786";

const base: DatosInvitado = {
  ...DATOS_INVITADO_VACIOS,
  email: "Comprador@cliente.example ",
  emailConfirmacion: "comprador@cliente.example",
  nombre: "Ana Pérez",
  telefono: "+54 376 4123456",
  nroDoc: DNI,
  cp: "3300",
};
const envio = { tipo: "envio", calle: "Av. Siempre Viva 123", ciudad: "Posadas", provincia: "Misiones" } as const;
const retiro = { tipo: "retiro" } as const;

describe("contacto del invitado", () => {
  it("válido", () => {
    expect(validarContactoInvitado(base)).toEqual({});
  });
  it("correos distintos: «Los correos electrónicos no coinciden.»", () => {
    expect(validarContactoInvitado({ ...base, emailConfirmacion: "otro@cliente.example" }).emailConfirmacion).toBe(
      "Los correos electrónicos no coinciden.",
    );
  });
  it("faltantes señalados", () => {
    const e = validarContactoInvitado(DATOS_INVITADO_VACIOS);
    expect(Object.keys(e).sort()).toEqual(["email", "nombre", "telefono"]);
  });
  it("correo sin forma de correo", () => {
    expect(validarContactoInvitado({ ...base, email: "nada", emailConfirmacion: "nada" }).email).toBe(ERRORES_INVITADO.emailInvalido);
  });
});

describe("facturación del invitado", () => {
  it("consumidor final con envío: nombre + DNI, el domicilio es el de la entrega", () => {
    expect(erroresFacturacionInvitado(base, envio)).toBeNull();
    expect(cuerpoFacturacionInvitado(base, envio)).toEqual({ modo: "consumidor_final", nroDoc: DNI, domicilioCp: "3300" });
  });

  it("consumidor final con DNI inválido: error en usted sobre el documento", () => {
    const r = erroresFacturacionInvitado({ ...base, nroDoc: "12" }, envio);
    expect(r?.campo).toBe("nroDoc");
  });

  it("factura A exige CUIT válido, razón social y condición frente al IVA", () => {
    const a: DatosInvitado = { ...base, modo: "factura_a", nroDoc: CUIT, razonSocial: "Empresa SA", condicionIva: "responsable_inscripto" };
    expect(erroresFacturacionInvitado(a, envio)).toBeNull();
    expect(cuerpoFacturacionInvitado(a, envio)).toMatchObject({ modo: "factura_a", razonSocial: "Empresa SA", condicionIva: "responsable_inscripto" });
    expect(erroresFacturacionInvitado({ ...a, condicionIva: "" }, envio)?.campo).toBe("condicionIva");
    expect(erroresFacturacionInvitado({ ...a, razonSocial: "" }, envio)?.campo).toBe("razonSocial");
    expect(erroresFacturacionInvitado({ ...a, nroDoc: "20123456780" }, envio)?.campo).toBe("nroDoc");
  });

  it("en retiro el domicilio de facturación viaja en el mismo bloque", () => {
    const d = { ...base, calle: "San Martín 100", ciudad: "Posadas", provincia: "Misiones" };
    expect(cuerpoFacturacionInvitado(d, retiro)).toMatchObject({
      domicilioCalle: "San Martín 100",
      domicilioCiudad: "Posadas",
      domicilioProvincia: "Misiones",
      domicilioCp: "3300",
    });
    expect(erroresFacturacionInvitado(d, retiro)).toBeNull();
    // Sin domicilio no se factura.
    expect(erroresFacturacionInvitado({ ...base }, retiro)).not.toBeNull();
  });

  it("código postal vacío o inválido", () => {
    expect(erroresFacturacionInvitado({ ...base, cp: "" }, envio)?.campo).toBe("domicilioCp");
    expect(erroresFacturacionInvitado({ ...base, cp: "12" }, envio)?.campo).toBe("domicilioCp");
  });
});

describe("invitadoCompleto y cuerpo del pedido", () => {
  it("completo sólo con contacto y facturación válidos", () => {
    expect(invitadoCompleto(base, envio)).toBe(true);
    expect(invitadoCompleto({ ...base, telefono: "" }, envio)).toBe(false);
    expect(invitadoCompleto({ ...base, cp: "" }, envio)).toBe(false);
  });

  it("los campos extra del POST incluyen verificación, tiempo y el señuelo vacío", () => {
    const c = camposDeInvitadoParaPedido(base, envio, { turnstile: "tok-de-prueba", iniciado: 1_700_000_000_000 });
    expect(c).toMatchObject({
      email: "Comprador@cliente.example",
      emailConfirmacion: "comprador@cliente.example",
      turnstile: "tok-de-prueba",
      iniciado: 1_700_000_000_000,
      sitio_web: "",
    });
    expect(c.facturacionInvitado).toMatchObject({ modo: "consumidor_final", domicilioCp: "3300" });
  });

  it("si un bot completa el señuelo, viaja tal cual (el servidor lo descarta)", () => {
    const c = camposDeInvitadoParaPedido(base, envio, { turnstile: "t", iniciado: 1, trampa: "http://spam.example" });
    expect(c.sitio_web).toBe("http://spam.example");
  });
});

describe("textos de invitado: registro de usted", () => {
  const REGISTRO =
    /\b(?:tu|tus|te|vos|sos|probá|revisá|ingresá|elegí|escribinos|podés|tenés|querés|pagás|pagá|retirás|recargá|completá|llamá|usá|esperá|intentá|volvé|pedí|dale|ojo|che)\b/i;
  const todos = [...Object.values(TEXTOS_INVITADO), ...Object.values(ERRORES_INVITADO)];
  it.each(todos)("%s", (texto) => {
    expect(texto).not.toMatch(REGISTRO);
  });
  it("el mensaje sin token apunta al enlace del correo", () => {
    expect(TEXTOS_INVITADO.sinToken).toBe("Para continuar, use el enlace «Pagar su pedido» que le enviamos por correo.");
  });
});

describe("emailParaCupon", () => {
  it("sólo devuelve el email válido y confirmado, normalizado", async () => {
    const { emailParaCupon } = await import("./invitado-form");
    expect(emailParaCupon({ email: " Ana@Cliente.example ", emailConfirmacion: "ana@cliente.example" })).toBe("ana@cliente.example");
    expect(emailParaCupon({ email: "ana@cliente", emailConfirmacion: "ana@cliente" })).toBe("");
    expect(emailParaCupon({ email: "ana@cliente.example", emailConfirmacion: "" })).toBe("");
  });
});
