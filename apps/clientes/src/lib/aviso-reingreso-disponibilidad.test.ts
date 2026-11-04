import { describe, expect, it } from "vitest";
import { nombreConOpcion } from "./aviso-reingreso-disponibilidad";

describe("nombreConOpcion", () => {
  it("producto suelto: el nombre", () => {
    expect(nombreConOpcion({ nombre: "Lámpara", etiqueta: null })).toBe("Lámpara");
  });
  it("variante: nombre y opción", () => {
    expect(nombreConOpcion({ nombre: "Lámpara", etiqueta: "Blanco cálido" })).toBe("Lámpara — Blanco cálido");
  });
  it("si el nombre ya trae la opción, no la repite", () => {
    expect(nombreConOpcion({ nombre: "Lámpara Blanco cálido", etiqueta: "Blanco cálido" })).toBe("Lámpara Blanco cálido");
  });
});
