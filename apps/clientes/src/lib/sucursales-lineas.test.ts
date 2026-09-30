import { describe, expect, it } from "vitest";
import casos from "./__fixtures__/sucursales-lineas-casos.json";
import { asignarSucursal, origenDeLinea, type SucursalDato } from "./sucursales";

/**
 * `asignarSucursal` con líneas (rebanada B, lote 1). Los casos viven en un fixture APARTE del
 * compartido con el CRM (`sucursales-casos.json`, que no se toca): esto sólo lo usa el Shop.
 */

const sucursales = casos.dataset.sucursales as SucursalDato[];
type Stock = Record<string, Record<string, number | null>>;
const stockDe = (stock: Stock) => (sucursal: string, id: string) => {
  const v = stock[sucursal]?.[id];
  return v === undefined ? 0 : v;
};

describe("asignarSucursal con líneas (fixture del Shop)", () => {
  for (const c of casos.casos) {
    it(c.caso, () => {
      const r = asignarSucursal(
        c.entrada as never,
        { ...casos.dataset, reglas: { trasladoDias: c.trasladoDias } } as never,
        stockDe(c.stock as Stock),
      );
      expect(r).toEqual(c.esperado);
    });
  }
});

describe("asignarSucursal con líneas: propiedades", () => {
  const datos = { ...casos.dataset, reglas: { trasladoDias: 7 } } as never;
  const entrada = casos.casos[0].entrada as never;
  const stock = stockDe(casos.casos[0].stock as Stock);

  it("es determinista y no muta los datos de entrada", () => {
    const copia = structuredClone(casos.dataset);
    const a = asignarSucursal(entrada, datos, stock);
    const b = asignarSucursal(entrada, datos, stock);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(casos.dataset).toEqual(copia);
  });

  it("no depende del orden de las sucursales en la entrada", () => {
    const invertido = { ...casos.dataset, sucursales: [...casos.dataset.sucursales].reverse(), reglas: { trasladoDias: 7 } };
    expect(asignarSucursal(entrada, invertido as never, stock)).toEqual(asignarSucursal(entrada, datos, stock));
  });

  it("con líneas y sin función de stock falla explícito (no asigna a ciegas)", () => {
    expect(() => asignarSucursal(entrada, datos)).toThrow(/stock/);
  });

  it("sin `lineas` el resultado es el de la rebanada A: sin claves nuevas", () => {
    const r = asignarSucursal(
      { entregaTipo: "envio", provincia: "Misiones", ciudad: "Puerto Iguazú" },
      casos.dataset as never,
    );
    expect(r).not.toHaveProperty("lineas");
    expect(r).not.toHaveProperty("demoraDias");
    expect((r as { regla: { lineasATraer: string[] } }).regla.lineasATraer).toEqual([]);
  });

  it("los errores de las reglas de la A siguen mandando sobre las líneas", () => {
    const r = asignarSucursal(
      { entregaTipo: "envio", provincia: "Misiones", ciudad: "Rosario", lineas: [{ id: "A", qty: 1, ocultoEn: [] }] },
      datos,
      () => 5,
    );
    expect(r).toEqual({ error: "sin_envio" });
  });
});

describe("origenDeLinea", () => {
  const sinStock = () => 0;

  it("prefiere la sucursal indicada si cubre la cantidad", () => {
    expect(origenDeLinea({ id: "A", qty: 2, ocultoEn: [] }, "sede-b", sucursales, () => 2)).toEqual({
      origen: "sede-b",
      aTraer: false,
    });
  });

  it("el respaldo sigue el `orden` de las sucursales, no el orden del arreglo", () => {
    const tres: SucursalDato[] = [
      { ...sucursales[1], slug: "sede-c", orden: 3, predeterminada: false },
      sucursales[1],
      sucursales[0],
    ];
    const stock = (s: string) => (s === "sede-a" || s === "sede-c" ? 5 : 0);
    expect(origenDeLinea({ id: "A", qty: 1, ocultoEn: [] }, "sede-b", tres, stock)).toEqual({
      origen: "sede-a",
      aTraer: true,
    });
  });

  it("una sucursal inactiva no es origen ni respaldo", () => {
    const inactiva = sucursales.map((s) => (s.slug === "sede-a" ? { ...s, activa: false } : s));
    expect(origenDeLinea({ id: "A", qty: 1, ocultoEn: [] }, "sede-b", inactiva, (s) => (s === "sede-a" ? 9 : 0))).toEqual({
      error: "sin_stock",
    });
  });

  it("sin sucursal activa fuera de `ocultoEn` no es servible; con candidatas sin stock es sin_stock", () => {
    expect(origenDeLinea({ id: "A", qty: 1, ocultoEn: ["sede-a", "sede-b"] }, "sede-a", sucursales, () => 9)).toEqual({
      error: "no_servible",
    });
    expect(origenDeLinea({ id: "A", qty: 1, ocultoEn: ["sede-a"] }, "sede-a", sucursales, sinStock)).toEqual({
      error: "sin_stock",
    });
  });

  it("un slug huérfano en `ocultoEn` (sucursal que no existe) se ignora", () => {
    expect(origenDeLinea({ id: "A", qty: 1, ocultoEn: ["sede-borrada"] }, "sede-a", sucursales, () => 1)).toEqual({
      origen: "sede-a",
      aTraer: false,
    });
  });
});
