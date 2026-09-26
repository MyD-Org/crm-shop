import { describe, expect, it } from "vitest";
import { tienePerfilFacturacion } from "./mis-datos";

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
