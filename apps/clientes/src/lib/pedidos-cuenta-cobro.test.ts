import { describe, expect, it } from "vitest";
import { cuentaDeDetalleRechazo, detalleCredencialesRechazadas, pagoInfoDelCobro } from "./pedidos";
import { ErrorProveedor, esCredencialRechazada } from "./pagos/tipos";

/** Cuenta de cobro en el intento y en `orders.pago_info` (contrato aditivo con el CRM). Puro. */

const info = { tipo: "credito" as const, marca: "Visa", ultimos4: "4242" };

describe("pagoInfoDelCobro", () => {
  it("cobro aprobado sin fallback: el medio + cuentaCobro, sin cuentaCobroPrevista", () => {
    expect(pagoInfoDelCobro({ info, cuenta: "mdp", cuentaPrevista: "mdp" }, true)).toEqual({ ...info, cuentaCobro: "mdp" });
  });

  it("cobro aprobado con fallback: cuentaCobro y cuentaCobroPrevista", () => {
    expect(pagoInfoDelCobro({ info, cuenta: "igz", cuentaPrevista: "mdp" }, true)).toEqual({
      ...info,
      cuentaCobro: "igz",
      cuentaCobroPrevista: "mdp",
    });
  });

  it("aprobado sin medio informado: igual lleva la cuenta", () => {
    expect(pagoInfoDelCobro({ info: null, cuenta: "igz", cuentaPrevista: "mdp" }, true)).toEqual({
      cuentaCobro: "igz",
      cuentaCobroPrevista: "mdp",
    });
  });

  it("sin prevista (pedido sin cuenta prevista): sólo cuentaCobro", () => {
    expect(pagoInfoDelCobro({ info, cuenta: "igz", cuentaPrevista: null }, true)).toEqual({ ...info, cuentaCobro: "igz" });
  });

  it("intento anterior a la 0035 (sin cuenta): el medio tal cual, sin claves de cuenta", () => {
    expect(pagoInfoDelCobro({ info, cuenta: null, cuentaPrevista: null }, true)).toEqual(info);
  });

  it("no aprobado y sin medio: no se toca pago_info", () => {
    expect(pagoInfoDelCobro({ info: null, cuenta: "mdp", cuentaPrevista: "mdp" }, false)).toBeNull();
    expect(pagoInfoDelCobro({ info: null, cuenta: null, cuentaPrevista: null }, true)).toBeNull();
  });
});

describe("evidencia de credenciales rechazadas", () => {
  it("detalle y lectura de la cuenta", () => {
    expect(detalleCredencialesRechazadas("mdp")).toBe("credenciales_rechazadas:mdp");
    expect(detalleCredencialesRechazadas("mar-del-plata", "cliente")).toBe("credenciales_rechazadas:mar-del-plata:cliente");
    expect(cuentaDeDetalleRechazo("credenciales_rechazadas:mdp")).toBe("mdp");
    expect(cuentaDeDetalleRechazo("credenciales_rechazadas:mar-del-plata:cliente")).toBe("mar-del-plata");
    expect(cuentaDeDetalleRechazo("error_proveedor: 401")).toBeNull();
    expect(cuentaDeDetalleRechazo(null)).toBeNull();
  });

  it("sólo 401/403 del procesador son credenciales rechazadas", () => {
    expect(esCredencialRechazada(new ErrorProveedor("x", 401))).toBe(true);
    expect(esCredencialRechazada(new ErrorProveedor("x", 403))).toBe(true);
    for (const status of [400, 402, 404, 422, 500, 502, 504]) {
      expect(esCredencialRechazada(new ErrorProveedor("x", status))).toBe(false);
    }
    expect(esCredencialRechazada(new Error("401"))).toBe(false);
    expect(esCredencialRechazada(new TypeError("fetch failed"))).toBe(false);
  });
});
