import { describe, expect, it } from "vitest";
import {
  armarContactoPedido,
  digitosWhatsapp,
  enlaceWhatsapp,
  mensajePorDefecto,
  plazoTexto,
} from "./contacto-pedido";

// Números ficticios: nunca datos reales en un repo público.
const TEL = "+54 9 11 5555-0100";

describe("enlaceWhatsapp", () => {
  it("arma https://wa.me/<dígitos> sin símbolos ni espacios", () => {
    expect(digitosWhatsapp(TEL)).toBe("5491155550100");
    expect(enlaceWhatsapp(TEL)).toBe("https://wa.me/5491155550100");
  });
  it("con texto precargado lo codifica", () => {
    expect(enlaceWhatsapp(TEL, "Hola, pedido PED-1 & más")).toBe(
      "https://wa.me/5491155550100?text=Hola%2C%20pedido%20PED-1%20%26%20m%C3%A1s",
    );
  });
  it("sin número o con algo que no es un teléfono: null", () => {
    expect(enlaceWhatsapp("")).toBeNull();
    expect(enlaceWhatsapp(null)).toBeNull();
    expect(enlaceWhatsapp("123")).toBeNull();
    expect(enlaceWhatsapp("1".repeat(16))).toBeNull();
  });
});

describe("plazo y mensaje por defecto", () => {
  it("24 horas hábiles", () => {
    expect(plazoTexto(24)).toBe("24 horas hábiles");
    expect(mensajePorDefecto(24)).toBe("Nos comunicaremos dentro de las 24 horas hábiles.");
  });
  it("1 hora y sin plazo (0)", () => {
    expect(plazoTexto(1)).toBe("1 hora hábil");
    expect(mensajePorDefecto(1)).toBe("Nos comunicaremos dentro de 1 hora hábil.");
    expect(plazoTexto(0)).toBe("a la brevedad");
    expect(mensajePorDefecto(0)).toBe("Nos comunicaremos a la brevedad.");
  });
});

describe("armarContactoPedido", () => {
  it("con sucursal: plazo de las reglas y enlace con el número visible", () => {
    const c = armarContactoPedido({ horasHabiles: 24, whatsapp: TEL, numeroPedido: "PED-00000042" });
    expect(c.mensaje).toBe("Nos comunicaremos dentro de las 24 horas hábiles.");
    expect(c.whatsapp?.visible).toBe(TEL);
    expect(c.whatsapp?.url).toBe(
      `https://wa.me/5491155550100?text=${encodeURIComponent("Hola, le escribo por mi pedido PED-00000042.")}`,
    );
  });

  it("el plazo sigue a la regla (48 h)", () => {
    expect(armarContactoPedido({ horasHabiles: 48, whatsapp: TEL }).mensaje).toContain("48 horas hábiles");
  });

  it("sin sucursal (o sin número): texto genérico y sin WhatsApp", () => {
    for (const whatsapp of [null, undefined, "", "   ", "abc"]) {
      const c = armarContactoPedido({ horasHabiles: 24, whatsapp });
      expect(c.whatsapp).toBeNull();
      expect(c.mensaje).toBe("Nos comunicaremos dentro de las 24 horas hábiles.");
    }
  });

  it("mensaje propio: reemplaza {plazo} y {whatsapp}", () => {
    const c = armarContactoPedido({
      horasHabiles: 24,
      whatsapp: TEL,
      mensajeConfirmacion: "Le responderemos dentro de {plazo}. Consultas: {whatsapp}. {plazo}",
    });
    expect(c.mensaje).toBe("Le responderemos dentro de 24 horas hábiles. Consultas: WhatsApp. 24 horas hábiles");
  });

  it("mensaje propio con {whatsapp}: siempre lo reemplaza por 'WhatsApp', con o sin número", () => {
    const c1 = armarContactoPedido({
      horasHabiles: 24,
      whatsapp: TEL,
      mensajeConfirmacion: "Escriba a {whatsapp} o espere {plazo}.",
    });
    expect(c1.mensaje).toBe("Escriba a WhatsApp o espere 24 horas hábiles.");

    const c2 = armarContactoPedido({
      horasHabiles: 24,
      whatsapp: null,
      mensajeConfirmacion: "Escriba a {whatsapp} o espere {plazo}.",
    });
    expect(c2.mensaje).toBe("Escriba a WhatsApp o espere 24 horas hábiles.");
  });

  it("mensaje vacío o en blanco = el por defecto", () => {
    for (const m of ["", "   ", null, undefined]) {
      expect(armarContactoPedido({ horasHabiles: 24, whatsapp: TEL, mensajeConfirmacion: m }).mensaje).toBe(
        mensajePorDefecto(24),
      );
    }
  });
});
