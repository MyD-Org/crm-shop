import { describe, expect, it } from "vitest";
import { destinoSeguro, rutaIngreso } from "./ingreso";

describe("rutaIngreso", () => {
  it("vuelve al checkout después de loguearse", () => {
    expect(rutaIngreso("/checkout")).toBe("/ingresar?redirect_url=%2Fcheckout");
  });

  it("conserva rutas con parámetros", () => {
    expect(rutaIngreso("/mi-cuenta/pedido/abc-123")).toBe(
      "/ingresar?redirect_url=%2Fmi-cuenta%2Fpedido%2Fabc-123",
    );
  });

  it("sin destino útil no agrega parámetro", () => {
    expect(rutaIngreso("/")).toBe("/ingresar");
  });
});

/**
 * Sin este filtro el login es un open redirect: un link armado a mano manda a
 * la víctima a un sitio falso justo después de loguearse en el real, que es el
 * momento en que más confía.
 */
describe("destinoSeguro — open redirect", () => {
  it("rechaza URLs absolutas a otro dominio", () => {
    expect(destinoSeguro("https://sitio-falso.com/pagar")).toBe("/");
    expect(destinoSeguro("http://sitio-falso.com")).toBe("/");
  });

  it("rechaza las URLs que parecen rutas pero son otro host", () => {
    expect(destinoSeguro("//sitio-falso.com")).toBe("/");
    expect(destinoSeguro("/\\sitio-falso.com")).toBe("/");
  });

  it("rechaza esquemas peligrosos", () => {
    expect(destinoSeguro("javascript:alert(1)")).toBe("/");
  });

  it("no vuelve al propio login, que sería un bucle", () => {
    expect(destinoSeguro("/ingresar")).toBe("/");
    expect(destinoSeguro("/ingresar?redirect_url=%2Fcheckout")).toBe("/");
  });

  it("acepta rutas internas", () => {
    expect(destinoSeguro("/checkout")).toBe("/checkout");
    expect(destinoSeguro("/carrito")).toBe("/carrito");
  });

  it("vacío o ausente cae al inicio", () => {
    expect(destinoSeguro(undefined)).toBe("/");
    expect(destinoSeguro("")).toBe("/");
  });
});
