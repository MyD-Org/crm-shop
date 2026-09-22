import { describe, expect, it } from "vitest";
import type { OrderItem } from "@/data/orders";
import { fmtPrecio } from "./format";
import { esIdPedido, etiquetaUnidades, subtituloLinea, unidadesPedido } from "./pedido-vista";

const linea = (p: Partial<OrderItem> = {}): OrderItem => ({
  id: "42",
  name: "02141N",
  brand: "",
  code: null,
  qty: 2,
  price: 538,
  total: 1076,
  nombreVisible: "Lámpara LED A60 9W E27",
  codigo: "02141N",
  ...p,
});

describe("subtituloLinea", () => {
  it("en la card: código y unidades", () => {
    expect(subtituloLinea(linea())).toBe("Cód. 02141N · 2 u.");
  });

  it("omite el código cuando repite el nombre (producto fuera del espejo)", () => {
    expect(subtituloLinea(linea({ nombreVisible: "02141N", codigo: "02141N" }))).toBe("2 u.");
  });

  it("en el detalle suma el unitario", () => {
    expect(
      subtituloLinea(linea({ nombreVisible: "02141N", codigo: "02141N" }), { detalle: true }),
    ).toBe(`2 u. · ${fmtPrecio(538)} c/u`);
    expect(subtituloLinea(linea(), { detalle: true })).toBe(
      `Cód. 02141N · 2 u. · ${fmtPrecio(538)} c/u`,
    );
  });
});

describe("unidades del pedido", () => {
  it("suma las cantidades de todas las líneas, no las líneas", () => {
    expect(unidadesPedido([linea({ qty: 2 }), linea({ qty: 3 })])).toBe(5);
    expect(unidadesPedido([])).toBe(0);
  });

  it("singular y plural", () => {
    expect(etiquetaUnidades(1)).toBe("1 producto");
    expect(etiquetaUnidades(3)).toBe("3 productos");
    expect(etiquetaUnidades(0)).toBe("0 productos");
  });
});

describe("esIdPedido", () => {
  it("acepta uuid y rechaza lo demás sin consultar la base", () => {
    expect(esIdPedido("9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f")).toBe(true);
    expect(esIdPedido("9F1C2D3E-4B5A-4C6D-8E7F-0A1B2C3D4E5F")).toBe(true);
    expect(esIdPedido("abc")).toBe(false);
    expect(esIdPedido("")).toBe(false);
    expect(esIdPedido("9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f/../x")).toBe(false);
  });
});
