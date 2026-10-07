import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PagoMercadoPago } from "./PagoMercadoPago";

vi.mock("@mercadopago/sdk-react", () => ({
  initMercadoPago: vi.fn(),
  Payment: () => createElement("div", { id: "paymentBrick_container" }),
  StatusScreen: () => null,
}));

afterEach(() => vi.unstubAllEnvs());

function renderPago(maxCuotas = 6) {
  return renderToStaticMarkup(createElement(PagoMercadoPago, {
    pedidoId: "pedido-prueba",
    numero: "PED-PRUEBA",
    monto: 1000,
    maxCuotas,
    onPagado: () => {},
  }));
}

describe("carga inicial del formulario de Mercado Pago", () => {
  it("muestra el loader mientras espera la preferencia, antes de montar el Brick", () => {
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "TEST-public-key");
    const html = renderPago(1);

    expect(html).toContain("Cargando los medios de pago");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('id="paymentBrick_container"');
    expect(html).not.toContain("Elija transferencia");
  });

  it("muestra un loader y mantiene el Brick montado pero no visible hasta onReady", () => {
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "TEST-public-key");
    const html = renderPago();

    expect(html).toContain("Cargando los medios de pago");
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/aria-hidden="true"[^>]*class="[^"]*invisible/);
    expect(html).toContain('id="paymentBrick_container"');
    expect(html).not.toContain("No se pudo completar el pago");
    expect(html).not.toContain("Elija transferencia");
  });

  it("no deja un loader infinito cuando falta la configuración", () => {
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "");
    const html = renderPago();

    expect(html).toContain("no está configurado");
    expect(html).not.toContain("Cargando los medios de pago");
    expect(html).not.toContain('id="paymentBrick_container"');
  });
});
