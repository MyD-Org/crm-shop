import { describe, expect, it } from "vitest";
import { SLUG_TRANSFERENCIA } from "../cuentas-bancarias";
import { avisoComprobante, TEXTO_AVISO_FALTA, TEXTO_AVISO_EN_REVISION } from "./aviso-card";

const base = { pagoMetodoSlug: SLUG_TRANSFERENCIA, pagoEstado: "pendiente", estado: "pendiente" };

describe("avisoComprobante", () => {
  it("falta: transferencia pendiente sin comprobantes informados", () => {
    expect(avisoComprobante({ ...base, comprobanteInformado: false })).toBe("falta");
    expect(avisoComprobante({ ...base })).toBe("falta");
  });
  it("en_revision: transferencia pendiente con un comprobante informado", () => {
    expect(avisoComprobante({ ...base, comprobanteInformado: true })).toBe("en_revision");
  });
  it("null si el pago ya está registrado", () => {
    expect(avisoComprobante({ ...base, pagoEstado: "pagado", comprobanteInformado: true })).toBeNull();
    expect(avisoComprobante({ ...base, pagoEstado: "pagado" })).toBeNull();
  });
  it("null si está cancelado", () => {
    expect(avisoComprobante({ ...base, estado: "cancelado" })).toBeNull();
    expect(avisoComprobante({ ...base, estado: "cancelado", comprobanteInformado: true })).toBeNull();
  });
  it("null si no es transferencia", () => {
    expect(avisoComprobante({ ...base, pagoMetodoSlug: "mercadopago" })).toBeNull();
    expect(avisoComprobante({ pagoEstado: "pendiente", estado: "pendiente" })).toBeNull();
  });
  it("null si el pago falló", () => {
    expect(avisoComprobante({ ...base, pagoEstado: "fallido" })).toBeNull();
  });
  it("los textos van en usted", () => {
    expect(TEXTO_AVISO_FALTA).toContain("Súbalo");
    expect(TEXTO_AVISO_EN_REVISION).toContain("su comprobante");
  });
});
