import { describe, expect, it } from "vitest";
import { estadoMisDatos, tienePerfilFacturacion } from "./mis-datos";

describe("estadoMisDatos", () => {
  it("vinculado gana siempre, tenga o no perfil o coincidencia", () => {
    for (const tienePerfil of [true, false]) {
      for (const coincideConAlegra of [true, false]) {
        expect(estadoMisDatos({ vinculado: true, tienePerfil, coincideConAlegra })).toBe("vinculado");
      }
    }
  });

  it("sin vincular y con documento de un cliente: sugiere vincular (sin preguntar)", () => {
    expect(estadoMisDatos({ vinculado: false, tienePerfil: true, coincideConAlegra: true })).toBe(
      "sugerir_vincular",
    );
  });

  it("sin vincular y sin perfil: pregunta si ya es cliente", () => {
    expect(estadoMisDatos({ vinculado: false, tienePerfil: false, coincideConAlegra: false })).toBe("preguntar");
  });

  it("sin vincular y con perfil propio: muestra el formulario", () => {
    expect(estadoMisDatos({ vinculado: false, tienePerfil: true, coincideConAlegra: false })).toBe("formulario");
  });
});

describe("tienePerfilFacturacion", () => {
  it("null, undefined o sin documento ni razón social: no hay perfil", () => {
    expect(tienePerfilFacturacion(null)).toBe(false);
    expect(tienePerfilFacturacion(undefined)).toBe(false);
    expect(tienePerfilFacturacion({ nroDoc: "", razonSocial: "  " })).toBe(false);
  });

  it("con documento o razón social: hay perfil", () => {
    expect(tienePerfilFacturacion({ nroDoc: "20123456789", razonSocial: "" })).toBe(true);
    expect(tienePerfilFacturacion({ nroDoc: "", razonSocial: "Cliente Ejemplo SA" })).toBe(true);
  });
});
