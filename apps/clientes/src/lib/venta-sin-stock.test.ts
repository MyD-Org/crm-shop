import { describe, expect, it } from "vitest";
import {
  agotadoSinModalidad,
  aVentaSinStock,
  esAPedido,
  flujoDelPedido,
  idsAPedido,
  leerSnapshot,
  lineaAPedido,
  modalidadPorId,
  pedidoAConfirmarPorModalidad,
  snapshotLinea,
  textoPlazoHabil,
  VentaSinStockCambioError,
  type VentaSinStock,
} from "./venta-sin-stock";
import type { DisponibilidadProducto } from "./sucursales-disponibilidad";

const M: VentaSinStock = { id: "m1", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea" };
const C: VentaSinStock = { id: "m2", texto: "A pedido", plazoDias: null, flujo: "a_confirmar" };
const s = snapshotLinea({ ...C, nombre: "Interna" });

describe("venta sin stock (módulo puro)", () => {
  it("a pedido sólo sin stock y con modalidad", () => {
    expect(esAPedido({ stock: "out", ventaSinStock: M })).toBe(true);
    expect(esAPedido({ stock: "low", ventaSinStock: M })).toBe(false);
    expect(agotadoSinModalidad({ stock: "out" })).toBe(true);
    expect(agotadoSinModalidad({ stock: "out", ventaSinStock: M })).toBe(false);
  });

  it("lineaAPedido: cantidad > stock pasa entera; sin modalidad nunca", () => {
    expect(lineaAPedido({ stockDisponible: 3, qty: 5, modalidad: M })).toBe(true);
    expect(lineaAPedido({ stockDisponible: 5, qty: 5, modalidad: M })).toBe(false);
    expect(lineaAPedido({ stockDisponible: 0, qty: 1 })).toBe(false);
    expect(lineaAPedido({ stockDisponible: null, qty: 9, modalidad: M })).toBe(false);
  });

  it("flujo: una línea a confirmar alcanza", () => {
    expect(flujoDelPedido([{ ventaSinStock: M }, {}])).toBe("normal");
    expect(flujoDelPedido([{ ventaSinStock: M }, { ventaSinStock: C }, {}])).toBe("a_confirmar");
  });

  it("snapshot y lectura defensiva", () => {
    expect(s).toEqual({ modalidadId: "m2", nombre: "Interna", texto: "A pedido", plazoDias: null, flujo: "a_confirmar" });
    expect(leerSnapshot(s)).toEqual(s);
    expect(leerSnapshot({ texto: 1 })).toBeNull();
    expect(leerSnapshot(null)).toBeNull();
    expect(leerSnapshot({ ...s, flujo: "otro" })).toBeNull();
    expect(leerSnapshot({ ...s, plazoDias: "2" })).toBeNull();
  });

  it("pedido a confirmar sólo con a_coordinar y una línea a_confirmar", () => {
    expect(pedidoAConfirmarPorModalidad("a_coordinar", [{ ventaSinStock: s }])).toBe(true);
    expect(pedidoAConfirmarPorModalidad("a_coordinar", [{ ventaSinStock: null }])).toBe(false);
    expect(pedidoAConfirmarPorModalidad("transferencia", [{ ventaSinStock: s }])).toBe(false);
  });

  it("pedidoAConfirmarPorModalidad: la misma regla sobre las líneas de la cotización (pantalla de éxito)", () => {
    // Líneas de `LineaCotizada` (VentaSinStock sin nombre), como las del pedido recién creado.
    expect(pedidoAConfirmarPorModalidad("a_coordinar", [{ ventaSinStock: C }, {}])).toBe(true);
    expect(pedidoAConfirmarPorModalidad("a_coordinar", [{ ventaSinStock: M }, {}])).toBe(false);
    // Cuenta corriente con su medio activo: no es "a confirmar por modalidad" (sigue con su texto).
    expect(pedidoAConfirmarPorModalidad("efectivo-cheque", [{ ventaSinStock: C }])).toBe(false);
    expect(pedidoAConfirmarPorModalidad("a_coordinar", [])).toBe(false);
  });

  it("aVentaSinStock quita el nombre; modalidadPorId busca por id", () => {
    const v = aVentaSinStock({ ...M, nombre: "Interna" });
    expect(v).toEqual(M);
    expect("nombre" in v).toBe(false);
    expect(modalidadPorId([M, C], "m2")).toBe(C);
    expect(modalidadPorId([M, C], "zz")).toBeUndefined();
    expect(modalidadPorId([M, C], null)).toBeUndefined();
  });

  it("textoPlazoHabil", () => {
    expect(textoPlazoHabil(null)).toBe("a coordinar");
    expect(textoPlazoHabil(1)).toBe("1 día hábil");
    expect(textoPlazoHabil(2)).toBe("2 días hábiles");
  });

  it("VentaSinStockCambioError lleva los ids", () => {
    const e = new VentaSinStockCambioError(["a", "b"]);
    expect(e).toBeInstanceOf(Error);
    expect(e.ids).toEqual(["a", "b"]);
  });

  it("idsAPedido por entrega", () => {
    const PRODUCTOS: Record<string, DisponibilidadProducto> = {
      p1: {
        envio: { estado: "por_pedido", origen: "igz", demoraDias: 2, despachoDias: 1 },
        retiro: {
          igz: { estado: "por_pedido", desde: null, demoraDias: 2 },
          mdp: { estado: "con_demora", desde: "igz", demoraDias: 7 },
        },
        servible: true,
      },
      p2: {
        envio: { estado: "a_traer", origen: "mdp", demoraDias: 7, despachoDias: 1 },
        retiro: { igz: { estado: "disponible", desde: null, demoraDias: null } },
        servible: true,
      },
      p3: { envio: null, retiro: null, servible: true },
    };
    expect([...idsAPedido(PRODUCTOS, { tipo: "envio", local: null })]).toEqual(["p1"]);
    expect([...idsAPedido(PRODUCTOS, { tipo: "retiro", local: "mdp" })]).toEqual([]);
    expect([...idsAPedido(PRODUCTOS, { tipo: "retiro", local: "igz" })]).toEqual(["p1"]);
    expect([...idsAPedido(PRODUCTOS, { tipo: "retiro", local: null })]).toEqual([]);
    expect([...idsAPedido({}, { tipo: "envio", local: null })]).toEqual([]);
  });
});
