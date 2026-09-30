import { describe, expect, it } from "vitest";
import { LARGO_MAX_CONSULTA, normalizarConsulta, pareceDatoPersonal } from "./normalizar";

describe("normalizarConsulta", () => {
  it("minúsculas, sin tildes, sin puntuación suelta y espacios colapsados", () => {
    expect(normalizarConsulta("  Luz CÁLIDA,   para el   patio?  ")).toBe("luz calida para el patio");
    expect(normalizarConsulta("¿Reflector 3000°K?")).toBe("reflector 3000°k");
  });

  it("recorta a 120 caracteres", () => {
    expect(normalizarConsulta("a".repeat(300))).toHaveLength(LARGO_MAX_CONSULTA);
  });

  it("vacía ⇒ null", () => {
    expect(normalizarConsulta("  ¿? ")).toBeNull();
  });

  it("un email o un teléfono no se interpreta ni se guarda", () => {
    expect(normalizarConsulta("persona@cliente.example")).toBeNull();
    expect(normalizarConsulta("llamar al +54 223 555-1234")).toBeNull();
    expect(normalizarConsulta("dni 30123456")).toBeNull();
  });
});

describe("pareceDatoPersonal", () => {
  it("medidas y modelos no son datos personales", () => {
    expect(pareceDatoPersonal("panel 600 600 40w")).toBe(false);
    expect(pareceDatoPersonal("tira 5050 12v 5 metros")).toBe(false);
    expect(pareceDatoPersonal("cable 2x1.5")).toBe(false);
  });
});
