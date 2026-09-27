import { describe, expect, it } from "vitest";
import { formatDescripcionProducto, formatNombreProducto } from "./formato-nombre";

describe("formatNombreProducto", () => {
  it("si no viene en mayúsculas sostenidas, lo deja como está", () => {
    expect(formatNombreProducto("Lampara Led Panel")).toBe("Lampara Led Panel");
    expect(formatNombreProducto("LAMPARA Led colgante")).toBe("LAMPARA Led colgante");
  });

  it("vacío se deja como está", () => {
    expect(formatNombreProducto("")).toBe("");
  });

  it("formato oración: sólo la primera letra en mayúscula", () => {
    expect(formatNombreProducto("LAMPARA COLGANTE DECORATIVA")).toBe("Lampara colgante decorativa");
    expect(formatNombreProducto("ABRAZADERA DE MANGUERA TIPO AMERICANO")).toBe(
      "Abrazadera de manguera tipo americano"
    );
  });

  it("preserva siglas conocidas y cortas", () => {
    expect(formatNombreProducto("CINTA LED RGB IP65")).toBe("Cinta LED RGB IP65");
    expect(formatNombreProducto("CABLE USB TV")).toBe("Cable USB TV");
    expect(formatNombreProducto("FUENTE AC/DC PVC")).toBe("Fuente AC/DC PVC");
    expect(formatNombreProducto("CERTIFICADO UL")).toBe("Certificado UL");
  });

  it("las palabras cortas del castellano no se toman por siglas", () => {
    expect(formatNombreProducto("TIRA DE LUZ CON SENSOR")).toBe("Tira de luz con sensor");
  });

  it("no toca la primera palabra si es sigla o código", () => {
    expect(formatNombreProducto("LED PANEL 60X60")).toBe("LED panel 60X60");
  });

  it("preserva unidades pegadas a números en su forma canónica", () => {
    expect(formatNombreProducto("FUENTE 12V 10W")).toBe("Fuente 12V 10W");
    expect(formatNombreProducto("PANEL LED 4000K")).toBe("Panel LED 4000K");
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
    expect(formatNombreProducto("LAMPARA LED JADEVER A60", "Jadever")).toBe("Lampara LED Jadever A60");
  });

  it("nombre real con siglas separadas por barra, puntuación y una unidad en minúscula", () => {
    expect(
      formatNombreProducto(
        "CABLE UTP CAT5E COLOR GRIS INTERIOR, 24AWG- ISO/IEC 11801, TIA/EIA 568. CERTIFICADO UL (100% COBRE), 305m"
      )
    ).toBe(
      "Cable UTP CAT5E color gris interior, 24AWG- ISO/IEC 11801, TIA/EIA 568. Certificado UL (100% cobre), 305m"
    );
  });

  it("combinación real: siglas, unidad, marca y código en el mismo nombre", () => {
    expect(formatNombreProducto("CINTA LED RGB 12V 5M JADEVER", "Jadever")).toBe("Cinta LED RGB 12V 5m Jadever");
  });
});

describe("formatDescripcionProducto", () => {
  it("formatea una descripción en mayúsculas sostenidas", () => {
    expect(formatDescripcionProducto("220VCA - 5 METROS")).toBe("220VCA - 5 metros");
  });

  it("respeta los saltos de línea y formatea cada línea", () => {
    expect(formatDescripcionProducto("LAMPARA LED 12V\nUSO INTERIOR")).toBe("Lampara LED 12V\nUso interior");
  });

  it("deja como está lo que ya viene presentable", () => {
    expect(formatDescripcionProducto("E27, 1620lm, 200-240VCa")).toBe("E27, 1620lm, 200-240VCa");
  });
});
