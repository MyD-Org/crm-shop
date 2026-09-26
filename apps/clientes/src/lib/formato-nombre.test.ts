import { describe, expect, it } from "vitest";
import { formatNombreProducto } from "./formato-nombre";

describe("formatNombreProducto", () => {
  it("si ya tiene alguna minúscula, lo deja como está", () => {
    expect(formatNombreProducto("Lampara Led Panel")).toBe("Lampara Led Panel");
    expect(formatNombreProducto("LAMPARA Led")).toBe("LAMPARA Led");
  });

  it("vacío se deja como está", () => {
    expect(formatNombreProducto("")).toBe("");
  });

  it("título normal, palabra por palabra", () => {
    expect(formatNombreProducto("LAMPARA COLGANTE DECORATIVA")).toBe(
      "Lampara Colgante Decorativa"
    );
  });

  it("preserva siglas conocidas", () => {
    expect(formatNombreProducto("CINTA LED RGB IP65")).toBe("Cinta LED RGB IP65");
    expect(formatNombreProducto("CABLE USB TV")).toBe("Cable USB TV");
    expect(formatNombreProducto("FUENTE AC/DC PVC")).toBe("Fuente AC/DC PVC");
  });

  it("preserva unidades pegadas a números en su forma canónica", () => {
    expect(formatNombreProducto("FUENTE 12V 10W")).toBe("Fuente 12V 10W");
    expect(formatNombreProducto("TRANSFORMADOR 220V")).toBe("Transformador 220V");
    expect(formatNombreProducto("PANEL LED 4000K")).toBe("Panel LED 4000K");
    // La fuente viene toda en mayúscula: "25MM" se lee "25mm".
    expect(formatNombreProducto("CANO 25MM")).toBe("Cano 25mm");
  });

  it("preserva medidas en pulgadas y fracciones", () => {
    expect(formatNombreProducto('CANO 1/2"')).toBe('Cano 1/2"');
  });

  it("preserva códigos de modelo con dígitos", () => {
    expect(formatNombreProducto("PANEL LED JDHU2909")).toBe("Panel LED JDHU2909");
    expect(formatNombreProducto("TERMICA 02141N")).toBe("Termica 02141N");
    expect(formatNombreProducto("LAMPARA A60")).toBe("Lampara A60");
  });

  it("preserva la marca del producto si aparece en el nombre, con su forma de exhibición", () => {
    expect(formatNombreProducto("LAMPARA LED JADEVER A60", "Jadever")).toBe(
      "Lampara LED Jadever A60"
    );
  });

  it("sin marca pasada, la palabra se titula como cualquier otra", () => {
    expect(formatNombreProducto("LAMPARA LED JADEVER A60")).toBe("Lampara LED Jadever A60");
  });

  it("combinación real: siglas, unidad, marca y código en el mismo nombre", () => {
    expect(formatNombreProducto("CINTA LED RGB 12V 5M JADEVER", "Jadever")).toBe(
      "Cinta LED RGB 12V 5m Jadever"
    );
  });
});
