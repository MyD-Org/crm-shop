import { describe, expect, it } from "vitest";
import { descripcionExhibida, nombreExhibido } from "./nombre-exhibido";

describe("nombreExhibido", () => {
  it("prefiere el nombre curado en el CRM", () => {
    expect(nombreExhibido({ overlayNombre: "Curado", description: "Descripción", name: "COD-1", code: "COD-1" })).toBe("Curado");
  });

  it("sin curado, el name de Alegra (la descripción son características)", () => {
    expect(
      nombreExhibido({ overlayNombre: null, description: "2 PIEZAS/JUEGO", name: "PUNTAS PH2 X 50MM", code: "JDSV2K12-JDV" })
    ).toBe("PUNTAS PH2 X 50MM");
  });

  it("si el name es el código, la descripción de Alegra", () => {
    expect(nombreExhibido({ overlayNombre: null, description: "TERMICA 2X16", name: "JDSDA261", code: "JDSDA261-JDV" })).toBe("TERMICA 2X16");
    expect(nombreExhibido({ overlayNombre: null, description: "TERMICA 2X16", name: "COD-1", code: "COD-1" })).toBe("TERMICA 2X16");
  });

  it("sin referencia usa el name", () => {
    expect(nombreExhibido({ overlayNombre: null, description: "Descripción", name: "COD-1", code: null })).toBe("COD-1");
  });

  it("un texto vacío no pisa: cae al siguiente", () => {
    expect(nombreExhibido({ overlayNombre: "", description: "", name: "COD-1", code: "COD-1" })).toBe("COD-1");
    expect(nombreExhibido({ overlayNombre: "  ", description: null, name: "COD-1", code: "COD-1" })).toBe("COD-1");
  });
});

describe("descripcionExhibida", () => {
  it("cuando el name es el código, la descripción ES el nombre exhibido: no hay descripción que mostrar", () => {
    expect(
      descripcionExhibida({ overlayNombre: null, description: "TERMICA 2X16", name: "JDSDA261", code: "JDSDA261-JDV" })
    ).toBeUndefined();
  });

  it("misma idea con mayúsculas/espacios distintos (normaliza antes de comparar)", () => {
    expect(
      descripcionExhibida({ overlayNombre: null, description: "  termica   2x16 ", name: "JDSDA261", code: "JDSDA261-JDV" })
    ).toBeUndefined();
  });

  it("si la descripción agrega información, se muestra", () => {
    expect(
      descripcionExhibida({ overlayNombre: null, description: "2 PIEZAS/JUEGO", name: "PUNTAS PH2 X 50MM", code: "JDSV2K12-JDV" })
    ).toBe("2 PIEZAS/JUEGO");
  });

  it("sin descripción, undefined", () => {
    expect(descripcionExhibida({ overlayNombre: null, description: null, name: "COD-1", code: "COD-1" })).toBeUndefined();
    expect(descripcionExhibida({ overlayNombre: null, description: "  ", name: "COD-1", code: "COD-1" })).toBeUndefined();
  });

  it("un nombre curado en el CRM igual a la descripción también la vacía", () => {
    expect(
      descripcionExhibida({ overlayNombre: "Termica 2x16", description: "TERMICA 2X16", name: "COD-1", code: "COD-1" })
    ).toBeUndefined();
  });
});
