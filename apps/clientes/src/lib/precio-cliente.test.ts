import { describe, expect, it } from "vitest";
import type { Product } from "@/data/products";
import { esPrecioDeCliente, precioGeneralTachado, precioPublicoConTransferencia } from "./precio-cliente";
import { aplicarEstadoPrecio } from "./precios-cuenta-estado";
import { TEXTOS_PRECIOS_CLIENTE, nombreDelCliente } from "./precios-cliente-textos";

// Datos inventados.
const base = {
  id: "1",
  name: "Panel",
  brand: "Marca",
  price: 1000,
  precioFinal: 1210,
  stock: "in",
} as unknown as Product;

const campania = { id: "c", nombre: "C", etiqueta: "C", fin: "2026-12-01T03:00:00.000Z", pct: 20, unidades: null, quedan: null };

describe("precioGeneralTachado (regla del tachado)", () => {
  it("su precio menor que el público: se tacha el público", () => {
    expect(precioGeneralTachado(900, 1210)).toBe(1210);
  });
  it("su precio igual: sin tachado", () => {
    expect(precioGeneralTachado(1210, 1210)).toBeUndefined();
  });
  it("su precio mayor: sin tachado", () => {
    expect(precioGeneralTachado(1500, 1210)).toBeUndefined();
  });
  it("sin alguno de los dos, o en cero (Consulte): sin tachado", () => {
    expect(precioGeneralTachado(undefined, 1210)).toBeUndefined();
    expect(precioGeneralTachado(900, undefined)).toBeUndefined();
    expect(precioGeneralTachado(0, 1210)).toBeUndefined();
  });
});

describe("precioPublicoConTransferencia", () => {
  it("sin lista de transferencia: el general con IVA", () => {
    expect(precioPublicoConTransferencia(base)).toBe(1210);
  });
  it("con transferencia destacada: ésa", () => {
    expect(
      precioPublicoConTransferencia({
        ...base,
        precioMedio: { slug: "transferencia", nombre: "Transferencia", price: 900, precioFinal: 1089 },
      }),
    ).toBe(1089);
  });
  it("con transferencia en la ficha o en el modal sin cobro en línea", () => {
    expect(
      precioPublicoConTransferencia({
        ...base,
        preciosMedios: [{ slug: "transferencia", nombre: "T", price: 950, precioFinal: 1149.5 }],
      }),
    ).toBe(1149.5);
    expect(
      precioPublicoConTransferencia({ ...base, preciosOfflineModal: [{ slug: "transferencia", nombre: "T", precioFinal: 1100 }] }),
    ).toBe(1100);
  });
  it("otro medio destacado (no transferencia): el general", () => {
    expect(
      precioPublicoConTransferencia({ ...base, precioMedio: { slug: "efectivo", nombre: "Efectivo", price: 800, precioFinal: 968 } }),
    ).toBe(1210);
  });
  it("sin IVA conocido: el neto", () => {
    expect(precioPublicoConTransferencia({ ...base, precioFinal: undefined })).toBe(1000);
  });
});

describe("sin lista privada no cambia nada", () => {
  it("sin estado de cuenta: el mismo producto, sin tachado nuevo ni etiqueta", () => {
    const p = aplicarEstadoPrecio(base, undefined);
    expect(p).toBe(base);
    expect(p.oldPrice).toBeUndefined();
    expect(esPrecioDeCliente(p)).toBe(false);
  });
  it("con campaña pública y sin lista: el oldPrice de la campaña queda intacto", () => {
    const enCampania = { ...base, oldPrice: 1500, campania } as Product;
    expect(aplicarEstadoPrecio(enCampania, undefined)).toBe(enCampania);
    expect(esPrecioDeCliente(enCampania)).toBe(false);
  });
  it("Consulte y pendiente: ni tachado ni etiqueta", () => {
    for (const estado of [{ tipo: "consulte" } as const, { tipo: "pendiente" } as const]) {
      const p = aplicarEstadoPrecio({ ...base, oldPrice: 1500 } as Product, estado);
      expect(p.oldPrice).toBeUndefined();
      expect(esPrecioDeCliente(p)).toBe(false);
    }
  });
});

describe("con precio privado", () => {
  it("etiqueta siempre; tachado sólo si es menor", () => {
    const menor = aplicarEstadoPrecio(base, { tipo: "privado", precio: { price: 800, precioFinal: 968 } });
    expect(esPrecioDeCliente(menor)).toBe(true);
    expect(menor.oldPrice).toBe(1210);
    const igual = aplicarEstadoPrecio(base, { tipo: "privado", precio: { price: 1000, precioFinal: 1210 } });
    expect(esPrecioDeCliente(igual)).toBe(true);
    expect(igual.oldPrice).toBeUndefined();
    const mayor = aplicarEstadoPrecio(base, { tipo: "privado", precio: { price: 1200, precioFinal: 1452 } });
    expect(esPrecioDeCliente(mayor)).toBe(true);
    expect(mayor.oldPrice).toBeUndefined();
  });
  it("tacha el precio con transferencia, no el general, si la transferencia es más barata", () => {
    const conTransf = {
      ...base,
      precioMedio: { slug: "transferencia", nombre: "Transferencia", price: 900, precioFinal: 1089 },
    } as Product;
    expect(aplicarEstadoPrecio(conTransf, { tipo: "privado", precio: { price: 800, precioFinal: 968 } }).oldPrice).toBe(1089);
    // Entre el de transferencia y el general: el suyo no es menor que con transferencia, sin tachado.
    expect(
      aplicarEstadoPrecio(conTransf, { tipo: "privado", precio: { price: 950, precioFinal: 1149.5 } }).oldPrice,
    ).toBeUndefined();
  });
  it("si gana una campaña, no es su precio de cliente (se tacha su privado, sin etiqueta)", () => {
    const enCampania = { ...base, price: 128, precioFinal: 154.88, oldPrice: 193.6, campania } as Product;
    const p = aplicarEstadoPrecio(enCampania, { tipo: "privado", precio: { price: 140, precioFinal: 169.4 } });
    expect(p.oldPrice).toBe(169.4);
    expect(esPrecioDeCliente(p)).toBe(false);
  });
});

describe("textos", () => {
  it("aviso sin decir cuenta corriente", () => {
    expect(TEXTOS_PRECIOS_CLIENTE.aviso).toBe("Precios de cliente aplicados");
    for (const t of [TEXTOS_PRECIOS_CLIENTE.aviso, TEXTOS_PRECIOS_CLIENTE.etiqueta, TEXTOS_PRECIOS_CLIENTE.checkoutPago]) {
      expect(t.toLowerCase()).not.toContain("cuenta corriente");
    }
  });

  it("nombreDelCliente: mayúsculas de Alegra a tipo título, siglas y minúsculas intactas", () => {
    expect(nombreDelCliente("ELECTRICIDAD PEREZ SRL")).toBe("Electricidad Perez SRL");
    expect(nombreDelCliente("CASA DE LA LUZ S.A.")).toBe("Casa de la Luz S.A.");
    expect(nombreDelCliente("LED 220 Y CIA")).toBe("Led 220 y Cia");
    expect(nombreDelCliente("Dalila")).toBe("Dalila");
    expect(nombreDelCliente("  ")).toBeNull();
    expect(nombreDelCliente(null)).toBeNull();
  });
});
