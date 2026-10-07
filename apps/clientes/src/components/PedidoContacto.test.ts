import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ContactoPedidoVista } from "@/lib/contacto-pedido";
import { PedidoContacto } from "./PedidoContacto";

const contacto = {
  mensaje: "Nos comunicaremos dentro de las 24 horas hábiles.",
  whatsapp: { url: "https://wa.me/5490000000000", numero: "+54 9 0000 0000" },
} as unknown as ContactoPedidoVista;

describe("PedidoContacto enlaceChico", () => {
  it("WhatsApp es un enlace de texto, no un botón, y el plazo es opcional", () => {
    const html = renderToStaticMarkup(createElement(PedidoContacto, { contacto, enlaceChico: true, mostrarPlazo: false }));
    expect(html).toContain("¿Tiene dudas?");
    expect(html).toContain("Escríbanos por WhatsApp");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("24 horas");
  });

  it("con plazo lo muestra", () => {
    const html = renderToStaticMarkup(createElement(PedidoContacto, { contacto, enlaceChico: true }));
    expect(html).toContain("Nos comunicaremos dentro de las 24 horas hábiles.");
  });
});
