import { describe, expect, it } from "vitest";
import { hrefWhatsApp, mensajeTraspaso } from "./chat-ia-handoff";

describe("mensajeTraspaso", () => {
  it("sin carrito ⇒ sólo el resumen", () => {
    expect(mensajeTraspaso("  Precio por 200 dicroicas  ", [], "https://cliente.example")).toBe("Precio por 200 dicroicas");
  });

  it("con carrito ⇒ agrega el link absoluto del carrito compartido", () => {
    expect(
      mensajeTraspaso("Consulta", [{ id: "12", qty: 3 }, { id: "5", qty: 1 }], "https://cliente.example/"),
    ).toBe("Consulta\n\nCarrito: https://cliente.example/carrito/compartido?i=12:3,5:1");
  });
});

describe("hrefWhatsApp", () => {
  it("codifica el mensaje", () => {
    expect(hrefWhatsApp("5491100000000", "Hola & chau\nok")).toBe(
      "https://wa.me/5491100000000?text=Hola%20%26%20chau%0Aok",
    );
  });

  it("teléfono inválido ⇒ null", () => {
    expect(hrefWhatsApp("+54 11 0000", "x")).toBeNull();
    expect(hrefWhatsApp("", "x")).toBeNull();
  });
});
