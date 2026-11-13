import { describe, expect, it } from "vitest";
import { congelarFacturacion } from "./contacto-alegra";
import { datosDelContactoInvitado, resolverFacturacionInvitado } from "./facturacion-invitado";

const ENVIO = { tipo: "envio", calle: "Calle Falsa 123", ciudad: "Mar del Plata", provincia: "Buenos Aires" } as const;
const RETIRO = { tipo: "retiro" } as const;

const consumidor = { modo: "consumidor_final", nroDoc: "30.123.456", domicilioCp: "7600" };
const facturaA = {
  modo: "factura_a",
  nroDoc: "30-71234567-1",
  razonSocial: "Empresa de Prueba SA",
  condicionIva: "responsable_inscripto",
  domicilioCp: "B7600ABC",
};

describe("resolverFacturacionInvitado", () => {
  it("consumidor final: nombre del contacto + DNI, condición consumidor final, domicilio de la entrega", () => {
    const r = resolverFacturacionInvitado(consumidor, ENVIO, "Ana Prueba");
    expect(r).toMatchObject({ ok: true, modo: "consumidor_final", tipoDoc: "DNI", nroDoc: "30123456" });
    if (!r.ok) throw new Error("no ok");
    expect(r.datos).toMatchObject({
      pais: "AR",
      tipoDoc: "DNI",
      nroDoc: "30123456",
      razonSocial: "Ana Prueba",
      condicionIva: "consumidor_final",
      domicilioCalle: "Calle Falsa 123",
      domicilioCiudad: "Mar del Plata",
      domicilioProvincia: "Buenos Aires",
      domicilioCp: "7600",
    });
  });

  it("consumidor final que escribe otro nombre fiscal lo conserva", () => {
    const r = resolverFacturacionInvitado({ ...consumidor, razonSocial: "Ana María Prueba" }, ENVIO, "Ana");
    expect(r.ok && r.datos.razonSocial).toBe("Ana María Prueba");
  });

  it("factura A: CUIT con dígito verificador + razón social + condición", () => {
    const r = resolverFacturacionInvitado(facturaA, ENVIO, "Contacto");
    expect(r).toMatchObject({ ok: true, modo: "factura_a", tipoDoc: "CUIT", nroDoc: "30712345671" });
    if (!r.ok) throw new Error("no ok");
    expect(r.datos).toMatchObject({ razonSocial: "Empresa de Prueba SA", condicionIva: "responsable_inscripto", domicilioCp: "B7600ABC" });
  });

  it("factura A con CUIT de dígito verificador incorrecto => error en usted y campo nroDoc", () => {
    const r = resolverFacturacionInvitado({ ...facturaA, nroDoc: "30-71234567-2" }, ENVIO, "Contacto");
    expect(r).toMatchObject({ ok: false, motivo: "facturacion_invalida" });
    if (r.ok) throw new Error("ok");
    expect(r.campos).toContain("nroDoc");
    expect(r.error).toMatch(/CUIT/);
  });

  it("factura A sin razón social o con condición inválida o consumidor final => error", () => {
    expect(resolverFacturacionInvitado({ ...facturaA, razonSocial: "" }, ENVIO, "Contacto")).toMatchObject({ ok: false });
    const sinCondicion = resolverFacturacionInvitado({ ...facturaA, condicionIva: undefined }, ENVIO, "Contacto");
    expect(sinCondicion).toMatchObject({ ok: false, campos: ["condicionIva"], error: "Elija su condición frente al IVA." });
    expect(resolverFacturacionInvitado({ ...facturaA, condicionIva: "consumidor_final" }, ENVIO, "C")).toMatchObject({ ok: false });
  });

  it("DNI inválido => error", () => {
    const r = resolverFacturacionInvitado({ ...consumidor, nroDoc: "123" }, ENVIO, "Ana");
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.campos).toContain("nroDoc");
  });

  it("modo ausente, desconocido o body que no es objeto => error en usted", () => {
    for (const raw of [undefined, null, "x", [], {}, { modo: "otro" }]) {
      const r = resolverFacturacionInvitado(raw, ENVIO, "Ana");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/^(Indique)/);
    }
  });

  it.each(["", "76", "ABCD", "12345", "7600ABC"])("código postal inválido %j", (cp) => {
    const r = resolverFacturacionInvitado({ ...consumidor, domicilioCp: cp }, ENVIO, "Ana");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.campos).toEqual(["domicilioCp"]);
  });

  it("retiro: el domicilio fiscal viene en el mismo bloque, con provincia canónica", () => {
    const sin = resolverFacturacionInvitado(consumidor, RETIRO, "Ana");
    expect(sin.ok).toBe(false);
    const r = resolverFacturacionInvitado(
      { ...consumidor, domicilioCalle: "Av. Siempreviva 742", domicilioCiudad: "Mar del Plata", domicilioProvincia: "buenos aires" },
      RETIRO,
      "Ana",
    );
    expect(r.ok && r.datos.domicilioProvincia).toBe("Buenos Aires");
  });

  it("en un envío manda la entrega: ignora un domicilio distinto del bloque", () => {
    const r = resolverFacturacionInvitado({ ...consumidor, domicilioCalle: "Otra 1", domicilioCiudad: "Otra" }, ENVIO, "Ana");
    expect(r.ok && r.datos.domicilioCalle).toBe("Calle Falsa 123");
  });

  it("se congela con la forma de siempre (sin tocar perfil)", () => {
    const r = resolverFacturacionInvitado(facturaA, ENVIO, "Contacto");
    if (!r.ok) throw new Error("no ok");
    expect(congelarFacturacion(r.datos)).toEqual({
      tipoDoc: "CUIT",
      nroDoc: "30712345671",
      razonSocial: "Empresa de Prueba SA",
      condicionIva: "responsable_inscripto",
      domicilio: "Calle Falsa 123, Mar del Plata, Buenos Aires, CP B7600ABC",
    });
  });

  it("los mensajes de error van en usted (sin tú/vos)", () => {
    const mensajes = [
      resolverFacturacionInvitado(undefined, ENVIO, ""),
      resolverFacturacionInvitado({ modo: "x" }, ENVIO, ""),
      resolverFacturacionInvitado({ ...facturaA, condicionIva: "x" }, ENVIO, ""),
      resolverFacturacionInvitado({ ...consumidor, nroDoc: "" }, ENVIO, "Ana"),
      resolverFacturacionInvitado({ ...consumidor, domicilioCp: "" }, ENVIO, "Ana"),
    ].map((r) => (r.ok ? "" : r.error));
    for (const m of mensajes) expect(m).not.toMatch(/\b(tu|tus|vos|te|ojo|probá|ingresá)\b/i);
  });
});

describe("datosDelContactoInvitado", () => {
  it("no es vinculado, no tiene Alegra ni perfil, y está completo", () => {
    const dc = datosDelContactoInvitado({ pais: "AR" });
    expect(dc).toMatchObject({
      fuente: "ninguna",
      vinculado: false,
      alegraId: null,
      completo: true,
      motivoRevision: null,
      telefonoAlegra: null,
      perfil: null,
      interno: null,
    });
  });
});
