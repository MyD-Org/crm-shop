import { describe, expect, it } from "vitest";
import { aGa4, aMeta, aPosthog, itemDe, valorDe, type EventoTracking } from "./eventos";

const lampara = itemDe({ id: "p1", name: "Lámpara LED 9W", brand: "Genérica", price: 1500.5 }, 2);
const cable = itemDe({ id: "p2", name: "Cable 2,5 mm", price: 800 }, 1);

const verProducto: EventoTracking = { tipo: "ver_producto", item: itemDe({ id: "p1", name: "Lámpara LED 9W", price: 1500.5 }) };
const agregar: EventoTracking = { tipo: "agregar_carrito", items: [lampara] };
const checkout: EventoTracking = { tipo: "iniciar_checkout", items: [lampara, cable] };
const pedido: EventoTracking = { tipo: "pedido_confirmado", pedidoId: "ped-1", numero: 42, total: 4500, items: [lampara, cable] };

describe("valorDe", () => {
  it("suma precio × cantidad, o el total real del pedido", () => {
    expect(valorDe(verProducto)).toBe(1500.5);
    expect(valorDe(agregar)).toBe(3001);
    expect(valorDe(checkout)).toBe(3801);
    expect(valorDe(pedido)).toBe(4500);
  });
});

describe("itemDe", () => {
  it("sin marca no deja la clave", () => {
    expect(cable).toEqual({ id: "p2", nombre: "Cable 2,5 mm", precio: 800, cantidad: 1 });
  });
});

describe("aMeta", () => {
  it("nombres estándar de Meta", () => {
    expect([verProducto, agregar, checkout, pedido].map((e) => aMeta(e).nombre)).toEqual([
      "ViewContent",
      "AddToCart",
      "InitiateCheckout",
      "Purchase",
    ]);
  });

  it("Purchase en ARS con eventID por pedido (deduplicación con la API de conversiones)", () => {
    const m = aMeta(pedido);
    expect(m.params).toMatchObject({
      content_ids: ["p1", "p2"],
      content_type: "product",
      contents: [{ id: "p1", quantity: 2 }, { id: "p2", quantity: 1 }],
      value: 4500,
      currency: "ARS",
      num_items: 3,
    });
    expect(m.opciones).toEqual({ eventID: "pedido-ped-1" });
    expect(aMeta(agregar).opciones).toBeUndefined();
  });
});

describe("aGa4", () => {
  it("esquema de ecommerce de GA4", () => {
    expect(aGa4(agregar)).toEqual({
      nombre: "add_to_cart",
      params: {
        currency: "ARS",
        value: 3001,
        items: [{ item_id: "p1", item_name: "Lámpara LED 9W", item_brand: "Genérica", price: 1500.5, quantity: 2 }],
      },
    });
    expect(aGa4(pedido)).toMatchObject({ nombre: "purchase", params: { transaction_id: "ped-1", value: 4500 } });
    expect(aGa4(verProducto).nombre).toBe("view_item");
    expect(aGa4(checkout).nombre).toBe("begin_checkout");
  });
});

describe("aPosthog", () => {
  it("nombre del dominio y props planas", () => {
    expect(aPosthog(pedido)).toMatchObject({
      nombre: "pedido_confirmado",
      props: { valor: 4500, moneda: "ARS", unidades: 3, pedido_id: "ped-1", pedido_numero: 42 },
    });
    expect(aPosthog(verProducto).props).toMatchObject({ producto_id: "p1" });
  });
});
