import { describe, expect, it } from "vitest";
import { limpiarUrl, rutaSinTracking } from "./url";

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

  it.each(["/", "/catalogo", "/producto/1", "/checkout", "/registrorama"])("%s ⇒ con tracking", (ruta) =>
    expect(rutaSinTracking(ruta)).toBe(false),
  );
});
