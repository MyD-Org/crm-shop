import { describe, expect, it } from "vitest";
import casos from "./__fixtures__/sucursales-lineas-casos.json";
import { desdeParaCantidad, stockPorLocal, vistaParaCantidad } from "./disponibilidad-cantidad";
import type { LocalDisponibilidad } from "./disponibilidad-textos";
import type { ReglasVenta, SucursalDato } from "./sucursales";
import { conTramosPorCantidad, disponibilidadAmbas } from "./sucursales-disponibilidad";

const sucursales = casos.dataset.sucursales as SucursalDato[];
const locales: LocalDisponibilidad[] = [
  { slug: "sede-a", nombre: "Sede A" },
  { slug: "sede-b", nombre: "Sede B" },
];

/** La vista de la ficha armada con el motor real: 2 en sede-b (zona) y 21 en sede-a. */
function vista(stock: Record<string, number> | null, reglas: ReglasVenta = { trasladoDias: 7 }, zona = "sede-b") {
  const entrada = {
    sucursales,
    zona,
    reglas,
    reservadoPorSucursal: {},
    ocultoEn: {},
    stockPorSucursal: { P: stock },
  };
  return conTramosPorCantidad(entrada, disponibilidadAmbas(entrada).productos).P;
}

describe("vistaParaCantidad", () => {
  const v = vista({ "sede-a": 21, "sede-b": 2 });

  it("hasta las unidades del local, la vista de 1 unidad: disponible hoy", () => {
    expect(vistaParaCantidad(v, 1).retiro?.["sede-b"].estado).toBe("disponible");
    expect(vistaParaCantidad(v, 2).retiro?.["sede-b"].estado).toBe("disponible");
    expect(desdeParaCantidad(v, 2)).toBe(1);
  });

  it("más que eso, con demora (la línea entera viene de la otra sucursal)", () => {
    expect(vistaParaCantidad(v, 3).retiro?.["sede-b"]).toEqual({ estado: "con_demora", desde: "sede-a", demoraDias: 7 });
    expect(vistaParaCantidad(v, 3).envio?.estado).toBe("a_traer");
    expect(vistaParaCantidad(v, 21).retiro?.["sede-b"].estado).toBe("con_demora");
    expect(desdeParaCantidad(v, 21)).toBe(3);
  });

  it("sin tramos (vista vieja o no inventariable) no cambia nada", () => {
    const sinTramos = { ...v, tramos: undefined };
    expect(vistaParaCantidad(sinTramos, 10)).toBe(sinTramos);
    expect(desdeParaCantidad(undefined, 10)).toBe(1);
  });
});

describe("stockPorLocal", () => {
  it("retiro elegido: las unidades de ese local y desde cuántas cambia el plazo", () => {
    expect(stockPorLocal(vista({ "sede-a": 21, "sede-b": 2 }), locales, { local: "sede-b", modalidad: "retiro" })).toEqual({
      texto: "En stock en Sede B: 2 disponibles",
      tono: "ok",
      detalle: "Más de 2 unidades: disponible en 7 días",
    });
  });

  it("envío elegido: el detalle es el plazo del envío", () => {
    expect(
      stockPorLocal(vista({ "sede-a": 21, "sede-b": 2 }), locales, { local: "sede-b", modalidad: "envio" })?.detalle,
    ).toBe("Más de 2 unidades: despacho dentro de 8 días hábiles");
  });

  it("el local tiene más que las otras: sin detalle", () => {
    expect(stockPorLocal(vista({ "sede-a": 21, "sede-b": 2 }), locales, { local: "sede-a", modalidad: "retiro" })).toEqual({
      texto: "En stock en Sede A: 21 disponibles",
      tono: "ok",
    });
  });

  it("sin unidades en el local: lo dice y cuántas se pueden traer", () => {
    expect(stockPorLocal(vista({ "sede-a": 21, "sede-b": 0 }), locales, { local: "sede-b", modalidad: "retiro" })).toEqual({
      texto: "Sin stock en Sede B",
      tono: "demora",
      detalle: "Hasta 21 unidades: disponible en 7 días",
    });
  });

  it("sin respaldo: no promete traerlo", () => {
    const v = vista({ "sede-a": 21, "sede-b": 2 }, { trasladoDias: 7, retiroSinStock: "bloquear" });
    expect(stockPorLocal(v, locales, { local: "sede-b", modalidad: "retiro" })).toEqual({
      texto: "En stock en Sede B: 2 disponibles",
      tono: "ok",
    });
  });

  it("una sola unidad en el local: «Últimas unidades», como el catálogo", () => {
    expect(stockPorLocal(vista({ "sede-a": 21, "sede-b": 1 }), locales, { local: "sede-b", modalidad: "retiro" })).toEqual({
      texto: "Últimas unidades en Sede B: 1 disponible",
      tono: "demora",
      detalle: "Más de 1 unidad: disponible en 7 días",
    });
    expect(stockPorLocal(vista({ "sede-a": 0, "sede-b": 1 }), locales, null)).toEqual({
      texto: "Últimas unidades en Sede B: 1 disponible",
      tono: "demora",
    });
  });

  it("demora 0: a coordinar", () => {
    const v = vista({ "sede-a": 21, "sede-b": 2 }, { trasladoDias: 0 });
    expect(stockPorLocal(v, locales, { local: "sede-b", modalidad: "retiro" })?.detalle).toBe("Más de 2 unidades: a coordinar");
  });

  it("sin ubicación elegida: cuántas hay en cada local, sin suponer cuál es el suyo", () => {
    expect(stockPorLocal(vista({ "sede-a": 21, "sede-b": 2 }), locales, null)).toEqual({
      texto: "En stock: 21 en Sede A · 2 en Sede B",
      tono: "ok",
    });
    expect(stockPorLocal(vista({ "sede-a": 0, "sede-b": 3 }), locales, null)).toEqual({
      texto: "En stock en Sede B: 3 disponibles",
      tono: "ok",
    });
  });

  it("sin datos por sucursal, no inventariable, sin stock o sucursal sin nombre: la etiqueta de siempre", () => {
    expect(stockPorLocal(undefined, locales, null)).toBeNull();
    expect(stockPorLocal(vista(null), locales, null)).toBeNull();
    expect(stockPorLocal(vista({ "sede-a": 0, "sede-b": 0 }), locales, null)).toBeNull();
    expect(stockPorLocal(vista({ "sede-a": 5, "sede-b": 2 }), [locales[1]], null)).toBeNull();
  });

  it("un local de referencia que no está entre los locales con retiro cae al detalle por local", () => {
    expect(stockPorLocal(vista({ "sede-a": 21, "sede-b": 2 }), locales, { local: "otra", modalidad: "envio" })?.texto).toBe(
      "En stock: 21 en Sede A · 2 en Sede B",
    );
  });
});
