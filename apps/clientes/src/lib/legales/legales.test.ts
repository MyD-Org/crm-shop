import { describe, expect, it } from "vitest";
import type { DatosLegales } from "@/data/home-defaults";
import { MINIMO_ENVIO } from "@/lib/envio";
import { fmtPesosEnteros } from "@/lib/format";
import { URL_DEFENSA_CONSUMIDOR, identificacionComercio, type Bloque } from "./comun";
import { bloquesTerminos } from "./terminos";
import { bloquesPrivacidad } from "./privacidad";
import { bloquesEnviosYPagos } from "./envios-y-pagos";
import { columnasFooter } from "./footer";
import { bloquesArrepentimiento } from "./arrepentimiento";

/** Todo el texto visible de una lista de bloques, en un solo string. */
function texto(bloques: Bloque[]): string {
  return bloques
    .flatMap((b) => [b.titulo, ...b.parrafos, ...(b.enlaces ?? []).map((e) => `${e.label} ${e.href}`)])
    .join("\n");
}

const COMPLETOS: DatosLegales = {
  razonSocial: "Comercio Ejemplo SA",
  cuit: "20-12345678-6",
  domicilio: "Calle Falsa 123, Ciudad Ejemplo",
  email: "legales@cliente.example",
};

describe("identificacionComercio", () => {
  it("solo las líneas con dato", () => {
    expect(identificacionComercio({})).toEqual([]);
    expect(identificacionComercio({ razonSocial: "Comercio Ejemplo SA", email: "legales@cliente.example" })).toEqual([
      "Razón social: Comercio Ejemplo SA",
      "Correo electrónico: legales@cliente.example",
    ]);
    expect(identificacionComercio(COMPLETOS)).toHaveLength(4);
  });
});

describe("términos y condiciones", () => {
  it("sin datos legales: sin etiquetas ni placeholders, con el resto del texto", () => {
    const t = texto(bloquesTerminos({}, { cuotas: false }));
    for (const prohibido of ["CUIT", "Razón social", "Domicilio", "[completar]", "@"]) {
      expect(t).not.toContain(prohibido);
    }
    expect(t).toContain("pesos argentinos");
  });

  it("con datos: identifica al comercio", () => {
    const t = texto(bloquesTerminos(COMPLETOS, { cuotas: false }));
    expect(t).toContain("Razón social: Comercio Ejemplo SA");
    expect(t).toContain("CUIT: 20-12345678-6");
  });

  it("plazos exactos: 6 meses de garantía y 10 días corridos de revocación, ningún otro", () => {
    const t = texto(bloquesTerminos(COMPLETOS, { cuotas: true }));
    expect(t).toMatch(/garantía[^\n]*6 meses/i);
    expect(t).toMatch(/10 días corridos/);
    expect(t).toContain("art. 11 de la Ley 24.240");
    expect(t).not.toMatch(/\b(?!6\b)\d+ meses/);
    expect(t).not.toMatch(/\b(?!10\b)\d+ días/);
    expect(t).not.toMatch(/30 días|12 meses/);
  });

  it("revocación sin costo, excepciones del art. 1116 y solo consumidor final", () => {
    const t = texto(bloquesTerminos({}, { cuotas: false }));
    expect(t).toContain("1115");
    expect(t).toMatch(/gastos de devolución son a cargo del comercio/);
    expect(t).toContain("1116");
    expect(t).toContain("consumidor final");
    expect(t).toContain("/arrepentimiento");
  });

  it("el Botón de arrepentimiento es un enlace interno, no la ruta como texto", () => {
    const bloques = bloquesTerminos({}, { cuotas: false });
    const enlaces = bloques.flatMap((b) => b.enlaces ?? []);
    expect(enlaces).toContainEqual({ label: "Botón de arrepentimiento", href: "/arrepentimiento" });
    expect(bloques.flatMap((b) => b.parrafos).join("\n")).not.toContain("/arrepentimiento");
  });

  it("CFT solo con cuotas; link a Defensa del Consumidor", () => {
    expect(texto(bloquesTerminos({}, { cuotas: false }))).not.toContain("CFT");
    expect(texto(bloquesTerminos({}, { cuotas: true }))).toContain("CFT");
    const enlaces = bloquesTerminos({}, { cuotas: false }).flatMap((b) => b.enlaces ?? []);
    expect(enlaces).toContainEqual(expect.objectContaining({ href: URL_DEFENSA_CONSUMIDOR, external: true }));
  });
});

describe("política de privacidad", () => {
  it("datos parciales: razón social y email sí, CUIT y domicilio no", () => {
    const t = texto(bloquesPrivacidad({ razonSocial: "Comercio Ejemplo SA", email: "legales@cliente.example" }));
    expect(t).toContain("Comercio Ejemplo SA");
    expect(t).toContain("legales@cliente.example");
    expect(t).not.toContain("CUIT");
    expect(t).not.toContain("Domicilio");
  });

  it("sin email legal: derechos sin email concreto ni placeholder; menciona la AAIP y la Ley 25.326", () => {
    const t = texto(bloquesPrivacidad({}));
    expect(t).not.toContain("@");
    expect(t).not.toContain("[completar]");
    expect(t).toMatch(/rectificación/);
    expect(t).toContain("Agencia de Acceso a la Información Pública");
    expect(t).toContain("25.326");
    expect(t).toMatch(/arrepentimiento/);
    expect(t).not.toMatch(/inscripci[oó]n n/i);
  });
});

describe("envíos y pagos", () => {
  it("envío apagado: sin ciudades, solo retiro", () => {
    const t = texto(bloquesEnviosYPagos({ envio: false, pagos: false, cuotas: false }));
    expect(t).not.toContain("Puerto Iguazú");
    expect(t).not.toContain("El Dorado");
    expect(t).toContain("Retiro en local / a coordinar");
  });

  it("envío prendido: ciudades y mínimo formateado", () => {
    const t = texto(bloquesEnviosYPagos({ envio: true, pagos: false, cuotas: false }));
    expect(t).toContain("Puerto Iguazú");
    expect(t).toContain("El Dorado");
    expect(t).toContain(fmtPesosEnteros(MINIMO_ENVIO));
  });

  it("pagos: apagado se coordina; prendido lista los medios; cuotas informa el CFT", () => {
    expect(texto(bloquesEnviosYPagos({ envio: false, pagos: false, cuotas: false }))).toContain("A coordinar con un asesor");
    const prendido = texto(bloquesEnviosYPagos({ envio: true, pagos: true, cuotas: true }));
    expect(prendido).toContain("Transferencia bancaria");
    expect(prendido).toContain("Tarjeta o Mercado Pago");
    expect(prendido).toContain("CFT");
    expect(texto(bloquesEnviosYPagos({ envio: true, pagos: true, cuotas: false }))).not.toContain("CFT");
  });
});

describe("columnas del footer", () => {
  it("Legales en orden, Defensa del Consumidor externo y nada de /carrito", () => {
    const columnas = columnasFooter({ arrepentimiento: false });
    const legales = columnas.find((c) => c.title === "Legales");
    expect(legales?.links.map((l) => l.href)).toEqual([
      "/terminos",
      "/privacidad",
      "/envios-y-pagos",
      URL_DEFENSA_CONSUMIDOR,
    ]);
    const todos = columnas.flatMap((c) => c.links);
    expect(todos.filter((l) => l.external).map((l) => l.label)).toEqual(["Defensa del Consumidor"]);
    expect(todos.some((l) => l.href === "/carrito")).toBe(false);
    expect(todos.filter((l) => l.label === "Envíos y pagos").map((l) => l.href)).toEqual(["/envios-y-pagos"]);
    expect(columnas.find((c) => c.title === "Contacto")?.links.map((l) => l.label)).toEqual(["WhatsApp", "Ubicación"]);
  });

  it("con arrepentimiento: el botón va antes de Defensa del Consumidor", () => {
    const legales = columnasFooter({ arrepentimiento: true }).find((c) => c.title === "Legales");
    expect(legales?.links.map((l) => l.href)).toEqual([
      "/terminos",
      "/privacidad",
      "/envios-y-pagos",
      "/arrepentimiento",
      URL_DEFENSA_CONSUMIDOR,
    ]);
  });
});

describe("botón de arrepentimiento", () => {
  it("solo el mínimo legal: 10 días corridos, sin costo, art. 1116 y consumidor final", () => {
    const t = texto(bloquesArrepentimiento({}));
    expect(t).toContain("10 días corridos");
    expect(t).toContain("art. 34 de la Ley 24.240");
    expect(t).toContain("1115");
    expect(t).toMatch(/no tiene costo/);
    expect(t).toContain("1116");
    expect(t).toContain("consumidor final");
    expect(t).not.toMatch(/\b(?!10\b)\d+ días/);
    expect(t).not.toMatch(/\d+ meses/);
  });

  it("explica cómo sigue el trámite: código en pantalla, copia por correo y contacto del comercio", () => {
    const t = texto(bloquesArrepentimiento({}));
    expect(t).toContain("código");
    expect(t).toMatch(/copia/);
    expect(t).toMatch(/se comunicará con usted/);
  });

  it("identificación del comercio solo con datos", () => {
    expect(texto(bloquesArrepentimiento({}))).not.toMatch(/CUIT|Razón social|Domicilio/);
    const t = texto(bloquesArrepentimiento(COMPLETOS));
    expect(t).toContain("Razón social: Comercio Ejemplo SA");
    expect(t).toContain("legales@cliente.example");
  });
});
