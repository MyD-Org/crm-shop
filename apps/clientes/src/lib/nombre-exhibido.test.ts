import { describe, expect, it } from "vitest";
import { nombreExhibido } from "./nombre-exhibido";

describe("nombreExhibido", () => {
  it("prefiere el nombre curado en el CRM", () => {
    expect(nombreExhibido({ overlayNombre: "Curado", description: "Descripción", name: "COD-1" })).toBe("Curado");
  });

  it("sin curado, la descripción de Alegra", () => {
    expect(nombreExhibido({ overlayNombre: null, description: "Descripción", name: "COD-1" })).toBe("Descripción");
  });

  it("un texto vacío no pisa: cae al siguiente", () => {
    expect(nombreExhibido({ overlayNombre: "", description: "", name: "COD-1" })).toBe("COD-1");
  });
});
