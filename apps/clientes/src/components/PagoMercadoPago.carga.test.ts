import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PagoMercadoPago } from "./PagoMercadoPago";

vi.mock("@mercadopago/sdk-react", () => ({
  initMercadoPago: vi.fn(),
  CardPayment: () => createElement("div", { id: "paymentBrick_container" }),
  StatusScreen: () => null,
}));

afterEach(() => vi.unstubAllEnvs());

function renderPago(cuotasPedido: number | null = 6, publicKey?: string) {
  return renderToStaticMarkup(createElement(PagoMercadoPago, {
    pedidoId: "pedido-prueba",
    numero: "PED-PRUEBA",
    monto: 1000,
    pagoMetodo: "mercadopago",
    cuotasPedido,
    publicKey,
    onPagado: () => {},
  }));
}

describe("carga inicial del formulario de Mercado Pago", () => {
  it("muestra un loader y mantiene el Brick montado pero no visible hasta onReady", () => {
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "TEST-public-key");
    const html = renderPago();

    expect(html).toContain("Cargando el formulario de pago");
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/aria-hidden="true"[^>]*class="[^"]*invisible/);
    expect(html).toContain('id="paymentBrick_container"');
    expect(html).not.toContain("No se pudo completar el pago");
    expect(html).not.toContain("Elija transferencia");
  });

  it("pregunta cómo pagar: crédito (abierta), débito y cuenta de Mercado Pago", () => {
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "TEST-public-key");
    const html = renderPago(6);
    expect(html).toContain("¿Cómo quiere pagar?");
    expect(html).toContain("Tarjeta de crédito");
    expect(html).toContain("Cuenta de Mercado Pago");
    // Las cuotas se eligen dentro del formulario: el débito se puede elegir siempre (el pedido pasa
    // a 1 pago al cobrar) y la opción de crédito no lleva las cuotas del pedido.
    expect(html).not.toContain("Sólo en un pago");
    expect(html).not.toContain("6 cuotas sin interés");
    // La cuenta no está elegida: su botón todavía no aparece.
    expect(html).not.toContain("Ir a Mercado Pago");
  });

  it("la public key que manda el servidor alcanza (sin la del entorno)", () => {
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "");
    const html = renderPago(null, "TEST-public-key-cuenta");
    expect(html).not.toContain("no está configurado");
    expect(html).toContain('id="paymentBrick_container"');
  });

  it("no deja un loader infinito cuando falta la configuración", () => {
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "");
    const html = renderPago();

    expect(html).toContain("no está configurado");
    expect(html).not.toContain("Cargando el formulario de pago");
    expect(html).not.toContain('id="paymentBrick_container"');
  });
});
