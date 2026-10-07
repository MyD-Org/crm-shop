import { describe, expect, it } from "vitest";
import { armarPreferencia, cuentaMpDisponible, urlRetorno } from "./mercadopago-preferencia";

const base = {
  pedidoId: "ped-1",
  numero: "000123",
  total: 1500.5,
  origen: "https://tienda.example",
};

describe("cuentaMpDisponible", () => {
  it("sólo en un pago: sin cuotas congeladas o con 1", () => {
    expect(cuentaMpDisponible(null)).toBe(true);
    expect(cuentaMpDisponible(undefined)).toBe(true);
    expect(cuentaMpDisponible(1)).toBe(true);
  });
  it("con 2 o más cuotas no se ofrece", () => {
    expect(cuentaMpDisponible(2)).toBe(false);
    expect(cuentaMpDisponible(12)).toBe(false);
  });
});

describe("urlRetorno", () => {
  it("vuelve al checkout del mismo pedido", () => {
    expect(urlRetorno("https://tienda.example", "ped 1")).toBe(
      "https://tienda.example/checkout?pedido=ped%201&pago=mp",
    );
  });
  it("sin https o con dominio local no hay URL (MP la rechaza)", () => {
    expect(urlRetorno("http://tienda.example", "p")).toBeUndefined();
    expect(urlRetorno("http://localhost:3000", "p")).toBeUndefined();
    expect(urlRetorno("https://127.0.0.1", "p")).toBeUndefined();
    expect(urlRetorno(undefined, "p")).toBeUndefined();
  });
});

describe("armarPreferencia", () => {
  it("un ítem con el total del pedido en ARS, una cuota y propósito wallet", () => {
    const p = armarPreferencia(base);
    expect(p.purpose).toBe("wallet_purchase");
    expect(p.items).toEqual([
      { id: "ped-1", title: "Pedido 000123 — Central LED", quantity: 1, unit_price: 1500.5, currency_id: "ARS" },
    ]);
    expect(p.payment_methods).toEqual({ installments: 1 });
  });

  it("external_reference = id del pedido (la conciliación lo usa)", () => {
    expect(armarPreferencia(base).external_reference).toBe("ped-1");
  });

  it("back_urls al checkout del pedido, auto_return y webhook existente", () => {
    const p = armarPreferencia(base);
    const url = "https://tienda.example/checkout?pedido=ped-1&pago=mp";
    expect(p.back_urls).toEqual({ success: url, pending: url, failure: url });
    expect(p.auto_return).toBe("approved");
    expect(p.notification_url).toBe("https://tienda.example/api/pagos/mercadopago/webhook?source_news=webhooks");
  });

  it("en local no manda back_urls, auto_return ni notification_url", () => {
    const p = armarPreferencia({ ...base, origen: "http://localhost:3000" });
    expect(p).not.toHaveProperty("back_urls");
    expect(p).not.toHaveProperty("auto_return");
    expect(p).not.toHaveProperty("notification_url");
  });

  it("incluye el email del comprador sólo si existe", () => {
    expect(armarPreferencia({ ...base, emailComprador: "ana@cliente.example" }).payer).toEqual({
      email: "ana@cliente.example",
    });
    expect(armarPreferencia(base)).not.toHaveProperty("payer");
  });

  it("redondea el monto a centavos", () => {
    expect(armarPreferencia({ ...base, total: 10.0051 }).items[0].unit_price).toBe(10.01);
  });
});
