import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas de texto de "Subir comprobante" en el detalle del pedido de Mi cuenta (change
 * `pago-transferencia-comprobante`, rebanada C): el botón sólo con transferencia pendiente, el
 * formulario es el de Informar pago con el pedido (medio fijo, monto precargado con el total, el
 * pedido viaja como `pedidoId`) y todo el texto va en usted.
 */
const detalle = readFileSync(join(__dirname, "PedidoDetalle.tsx"), "utf8");
const wrapper = readFileSync(join(__dirname, "InformarPagoPedido.tsx"), "utf8");
const informar = readFileSync(join(__dirname, "cuenta-corriente", "InformarPago.tsx"), "utf8");

describe("PedidoDetalle: Subir comprobante", () => {
  it("lo ofrece sólo si el pedido admite informar el pago, con el total y el número del pedido", () => {
    expect(detalle).toContain("puedeSubirComprobante(pedido)");
    expect(detalle).toContain("<InformarPagoPedido");
    expect(detalle).toMatch(/pedido=\{\{\s*id: pedido\.id,\s*numero: pedido\.numero,\s*total: pedido\.total\s*\}\}/);
  });
});

describe("InformarPagoPedido", () => {
  it("es el formulario de Informar pago con el pedido, y refresca la página al informar", () => {
    expect(wrapper).toContain("<InformarPago");
    expect(wrapper).toContain("pedido={pedido}");
    expect(wrapper).toContain("router.refresh()");
  });
});

describe("InformarPago con pedido", () => {
  it("manda pedidoId y fija el medio a transferencia, sin pedirlo", () => {
    expect(informar).toContain("pedidoId: pedido.id");
    expect(informar).toContain('method: pedido ? "transferencia" : method');
    expect(informar).toContain("{!pedido && (");
  });

  it("precarga el monto con el total del pedido y lo vuelve a precargar al reiniciar", () => {
    expect(informar.match(/montoPrecargado\(pedido\.total\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("el texto es del comprobante del pedido, en usted", () => {
    expect(informar).toContain("Subir comprobante");
    expect(informar).toContain("Adjunte el comprobante de su transferencia");
  });
});
