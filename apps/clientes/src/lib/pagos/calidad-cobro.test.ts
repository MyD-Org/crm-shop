import { describe, expect, it } from "vitest";
import { MAX_ITEMS_INFO, infoAdicionalDelPedido, sanearDeviceId, sanearIssuerId } from "./calidad-cobro";

describe("sanearIssuerId", () => {
  it("acepta dígitos como string o número", () => {
    expect(sanearIssuerId("310")).toBe("310");
    expect(sanearIssuerId(" 310 ")).toBe("310");
    expect(sanearIssuerId(12345)).toBe("12345");
  });

  it("descarta lo que no sea sólo dígitos, lo largo y lo ausente", () => {
    for (const v of ["31a", "3.1", "-3", "", "1".repeat(21), 3.5, -1, null, undefined, {}, ["310"]]) {
      expect(sanearIssuerId(v)).toBeUndefined();
    }
  });
});

describe("sanearDeviceId", () => {
  it("acepta letras, dígitos, punto, guion y guion bajo", () => {
    expect(sanearDeviceId("armor.abc-123_XYZ")).toBe("armor.abc-123_XYZ");
    expect(sanearDeviceId("a".repeat(100))).toHaveLength(100);
  });

  it("descarta lo que rompería un header, lo largo y lo que no es texto", () => {
    for (const v of ["a b", "a\r\nX-Otro: 1", "a;b", "ñ", "", "a".repeat(101), 123, null, undefined, {}]) {
      expect(sanearDeviceId(v)).toBeUndefined();
    }
  });
});

describe("infoAdicionalDelPedido", () => {
  const linea = (n: number, cantidad = 1, total = 100) => ({ sku: `SKU-${n}`, nombre: `Producto ${n}`, cantidad, total });

  it("arma líneas con precio unitario, nombre partido en el primer espacio y envío", () => {
    const info = infoAdicionalDelPedido(
      { contactoNombre: "  Ana   Pérez Gómez ", entregaTipo: "envio", entregaDireccion: "Calle Falsa 123", entregaCiudad: "Mar del Plata" },
      [linea(1, 3, 1000)],
    );
    expect(info).toEqual({
      items: [{ id: "SKU-1", titulo: "Producto 1", cantidad: 3, precioUnitario: 333.33 }],
      nombre: "Ana",
      apellido: "Pérez Gómez",
      envio: { direccion: "Calle Falsa 123", ciudad: "Mar del Plata" },
    });
  });

  it("sin apellido no lo inventa, y retiro en local no lleva envío aunque haya dirección", () => {
    const info = infoAdicionalDelPedido(
      { contactoNombre: "Ana", entregaTipo: "retiro", entregaDireccion: "Sucursal", entregaCiudad: "Mar del Plata" },
      [linea(1)],
    );
    expect(info).toMatchObject({ nombre: "Ana" });
    expect(info).not.toHaveProperty("apellido");
    expect(info).not.toHaveProperty("envio");
  });

  it("envío sin dirección cargada: sin envío", () => {
    expect(infoAdicionalDelPedido({ entregaTipo: "envio", entregaDireccion: " " }, [linea(1)])).not.toHaveProperty("envio");
  });

  it("cantidad fraccionaria: 1 unidad por el total de la línea", () => {
    const info = infoAdicionalDelPedido({}, [linea(1, 2.5, 1234.5)]);
    expect(info?.items).toEqual([{ id: "SKU-1", titulo: "Producto 1", cantidad: 1, precioUnitario: 1234.5 }]);
  });

  it("corta en el máximo de líneas y descarta las ilegibles", () => {
    const muchas = Array.from({ length: MAX_ITEMS_INFO + 20 }, (_, i) => linea(i));
    expect(infoAdicionalDelPedido({}, muchas)?.items).toHaveLength(MAX_ITEMS_INFO);
    expect(infoAdicionalDelPedido({}, [linea(1, 0), linea(2, 1, Number.NaN), linea(3)])?.items.map((i) => i.id)).toEqual(["SKU-3"]);
  });

  it("sin nada que informar: undefined", () => {
    expect(infoAdicionalDelPedido({}, [])).toBeUndefined();
    expect(infoAdicionalDelPedido({ contactoNombre: " " }, null)).toBeUndefined();
  });
});
