import { describe, expect, it } from "vitest";
import { nombrePila } from "./nombre-pila";

/**
 * Nombre con el que se saluda en Mi cuenta ("Hola, {nombre}"). Orden: nombre
 * de Clerk → primera palabra del nombre completo → razón social. null = el
 * saludo cae a "cliente".
 */
describe("nombrePila", () => {
  it("usa el nombre de Clerk si está", () => {
    expect(nombrePila({ firstName: "Dalila", fullName: "Dalila Cabeza" })).toBe("Dalila");
  });

  it("sin nombre, toma la primera palabra del nombre completo", () => {
    expect(nombrePila({ firstName: null, fullName: "  María José Pérez " })).toBe("María");
  });

  it("un nombre de Clerk en blanco no pisa: cae al nombre completo", () => {
    expect(nombrePila({ firstName: "  ", fullName: "Ana Gómez" })).toBe("Ana");
  });

  it("sin datos de la persona, la razón social completa", () => {
    expect(nombrePila({ razonSocial: "Electricidad Norte S.A." })).toBe("Electricidad Norte S.A.");
    expect(nombrePila({ firstName: null, fullName: null, razonSocial: " Electricidad Norte S.A. " })).toBe(
      "Electricidad Norte S.A.",
    );
  });

  it("todo vacío, en blanco o ausente → null", () => {
    expect(nombrePila({})).toBeNull();
    expect(nombrePila({ firstName: " ", fullName: "   ", razonSocial: "" })).toBeNull();
    expect(nombrePila({ firstName: null, fullName: null, razonSocial: null })).toBeNull();
  });
});
