import { describe, expect, it } from "vitest";
import { limpiarUrl, rutaSinTracking, urlSinQuery } from "./url";

describe("urlSinQuery", () => {
  it("origen + pathname: sin query, sin fragmento y sin atribución", () => {
    expect(urlSinQuery("https://tienda.example/ingresar?__clerk_ticket=x&utm_source=ig#f")).toBe("https://tienda.example/ingresar");
  });
  it("'' si no es una URL", () => {
    expect(urlSinQuery("no es url")).toBe("");
  });
});

describe("limpiarUrl", () => {
  it("deja origen, path y sólo los parámetros de atribución", () => {
    expect(
      limpiarUrl("https://tienda.example/catalogo?q=led&utm_source=ig&utm_campaign=lanzamiento&fbclid=abc&tema=azul"),
    ).toBe("https://tienda.example/catalogo?utm_source=ig&utm_campaign=lanzamiento&fbclid=abc");
  });

  it("descarta la lista del carrito compartido y los tickets de Clerk", () => {
    expect(limpiarUrl("https://tienda.example/carrito/compartido?i=p1.2,p2.1")).toBe(
      "https://tienda.example/carrito/compartido",
    );
    expect(limpiarUrl("https://tienda.example/mi-cuenta?__clerk_ticket=secreto&gclid=g1")).toBe(
      "https://tienda.example/mi-cuenta?gclid=g1",
    );
  });

  it("sin hash, y '' si no es una URL", () => {
    expect(limpiarUrl("https://tienda.example/producto/1#fotos")).toBe("https://tienda.example/producto/1");
    expect(limpiarUrl("no es url")).toBe("");
  });
});

describe("rutaSinTracking", () => {
  it.each(["/ingresar", "/ingresar/factor-uno", "/registro", "/registro/verificar", "/__gate", "/__clerk/v1/client"])(
    "%s ⇒ sin tracking",
    (ruta) => expect(rutaSinTracking(ruta)).toBe(true),
  );

  it.each(["/", "/catalogo", "/producto/1", "/checkout", "/registrorama", "/pagarx"])("%s ⇒ con tracking", (ruta) =>
    expect(rutaSinTracking(ruta)).toBe(false),
  );

  it.each(["/pagar", "/pagar/v1.abc", "/pagar/x/y"])("%s (enlace «Pagar su pedido» del mail) ⇒ sin tracking", (ruta) =>
    expect(rutaSinTracking(ruta)).toBe(true),
  );

  describe("checkout con el token de compra del invitado (`t`)", () => {
    it("la vuelta de Mercado Pago con `t` no se mide", () => {
      expect(rutaSinTracking("/checkout", "?pedido=p1&pago=mp&t=abc")).toBe(true);
      expect(rutaSinTracking("/checkout", "t=abc")).toBe(true);
      expect(rutaSinTracking("/checkout/", "?t=abc")).toBe(true);
    });
    it("sin `t` (o con otro parámetro que lo contiene) se mide como siempre", () => {
      expect(rutaSinTracking("/checkout", "?pedido=p1&pago=mp")).toBe(false);
      expect(rutaSinTracking("/checkout", "?utm_source=x&tt=1&at=2")).toBe(false);
      expect(rutaSinTracking("/checkout", "")).toBe(false);
      expect(rutaSinTracking("/checkout", undefined)).toBe(false);
    });
    it("`t` en otra página no la apaga", () => {
      expect(rutaSinTracking("/catalogo", "?t=abc")).toBe(false);
    });
  });
});

describe("limpiarUrl: el token de compra nunca llega a un proveedor", () => {
  it("descarta `t` aunque la ruta se mida", () => {
    expect(limpiarUrl("https://tienda.example/checkout?pedido=p1&pago=mp&t=v1.abc&utm_source=ig")).toBe(
      "https://tienda.example/checkout?utm_source=ig",
    );
  });
});
