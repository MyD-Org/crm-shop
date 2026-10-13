import { describe, expect, it } from "vitest";
import { nombreConOpcion, nombreDeLinea } from "./nombre-linea";

describe("nombreConOpcion", () => {
  it("suma la opción al nombre del modelo", () => {
    expect(nombreConOpcion("Panel 18W", "Blanco frío")).toBe("Panel 18W / Blanco frío");
  });

  it("sin opción (producto suelto) deja el nombre tal cual", () => {
    expect(nombreConOpcion("Panel 18W")).toBe("Panel 18W");
    expect(nombreConOpcion("Panel 18W", null)).toBe("Panel 18W");
    expect(nombreConOpcion("Panel 18W", "   ")).toBe("Panel 18W");
  });

  it("no repite la opción si el nombre ya la trae (nombre de Alegra de la variante)", () => {
    expect(nombreConOpcion("Panel 18W / Blanco frío", "Blanco frío")).toBe("Panel 18W / Blanco frío");
    expect(nombreConOpcion("Panel 18W / Blanco Frío", "blanco  frío")).toBe("Panel 18W / Blanco Frío");
  });

  it("es idempotente", () => {
    const una = nombreConOpcion("Panel 18W", "Rojo");
    expect(nombreConOpcion(una, "Rojo")).toBe(una);
  });
});

describe("nombreDeLinea", () => {
  it("usa la opción del producto", () => {
    expect(nombreDeLinea({ name: "Cinta LED", opcion: "RGB" })).toBe("Cinta LED / RGB");
    expect(nombreDeLinea({ name: "Cinta LED" })).toBe("Cinta LED");
  });
});
