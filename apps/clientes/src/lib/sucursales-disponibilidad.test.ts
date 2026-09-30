import { describe, expect, it } from "vitest";
import casos from "./__fixtures__/sucursales-lineas-casos.json";
import type { SucursalDato } from "./sucursales";
import { armarStockPorSucursal, disponibilidadPorSucursal, disponibleNeto } from "./sucursales-disponibilidad";

const sucursales = casos.dataset.sucursales as SucursalDato[];
const reglas = { trasladoDias: 7 };
const base = {
  sucursales,
  zona: "sede-a",
  modalidad: "envio" as const,
  reglas,
  reservadoPorSucursal: {},
  ocultoEn: {},
};

describe("disponibleNeto", () => {
  it("resta la reserva y nunca baja de cero", () => {
    expect(disponibleNeto({ "sede-a": 5 }, { "sede-a": 2 }, "sede-a")).toBe(3);
    expect(disponibleNeto({ "sede-a": 1 }, { "sede-a": 4 }, "sede-a")).toBe(0);
  });
  it("una sucursal sin fila vale 0 para un inventariable y null es no inventariable", () => {
    expect(disponibleNeto({ "sede-a": 5 }, undefined, "sede-b")).toBe(0);
    expect(disponibleNeto(undefined, undefined, "sede-b")).toBe(0);
    expect(disponibleNeto(null, { "sede-a": 9 }, "sede-a")).toBeNull();
  });
  it("la reserva de una sucursal no descuenta el stock de otra", () => {
    expect(disponibleNeto({ "sede-a": 5, "sede-b": 5 }, { "sede-b": 5 }, "sede-a")).toBe(5);
  });
});

describe("disponibilidadPorSucursal: envío", () => {
  it("sin stock en la zona el producto sigue visible: sale de la otra sucursal, a traer", () => {
    const r = disponibilidadPorSucursal({ ...base, stockPorSucursal: { P: { "sede-a": 0, "sede-b": 4 } } });
    expect(r.productos.P.servible).toBe(true);
    expect(r.productos.P.envio).toEqual({ estado: "a_traer", origen: "sede-b", demoraDias: 7 });
    expect(r.productos.P.retiro).toBeNull();
    expect(r.lineasATraer).toEqual(["P"]);
  });

  it("con stock en el origen: disponible, sin traslado", () => {
    const r = disponibilidadPorSucursal({ ...base, stockPorSucursal: { P: { "sede-a": 2 } } });
    expect(r.productos.P.envio).toEqual({ estado: "disponible", origen: "sede-a", demoraDias: null });
    expect(r.lineasATraer).toEqual([]);
  });

  it("la reserva de la sucursal cuenta: 3 en stock y 3 reservadas es sin stock allá", () => {
    const r = disponibilidadPorSucursal({
      ...base,
      stockPorSucursal: { P: { "sede-a": 3, "sede-b": 1 } },
      reservadoPorSucursal: { P: { "sede-a": 3 } },
    });
    expect(r.productos.P.envio).toEqual({ estado: "a_traer", origen: "sede-b", demoraDias: 7 });
  });

  it("sin stock en ninguna sucursal: sin_stock, pero servible (no se oculta)", () => {
    const r = disponibilidadPorSucursal({ ...base, stockPorSucursal: { P: {} } });
    expect(r.productos.P).toEqual({
      envio: { estado: "sin_stock", origen: null, demoraDias: null },
      retiro: null,
      servible: true,
    });
  });

  it("oculto en la sucursal de la zona: sale de la otra (Misiones -> MDP)", () => {
    const r = disponibilidadPorSucursal({
      ...base,
      stockPorSucursal: { P: { "sede-a": 5, "sede-b": 5 } },
      ocultoEn: { P: ["sede-a"] },
    });
    expect(r.productos.P.envio).toEqual({ estado: "a_traer", origen: "sede-b", demoraDias: 7 });
  });

  it("oculto en todas: no servible, aunque haya stock", () => {
    const r = disponibilidadPorSucursal({
      ...base,
      stockPorSucursal: { P: { "sede-a": 5, "sede-b": 5 } },
      ocultoEn: { P: ["sede-a", "sede-b"] },
    });
    expect(r.productos.P.servible).toBe(false);
    expect(r.productos.P.envio?.estado).toBe("no_servible");
  });

  it("no inventariable (null): siempre disponible en el origen", () => {
    const r = disponibilidadPorSucursal({ ...base, stockPorSucursal: { N: null } });
    expect(r.productos.N.envio).toEqual({ estado: "disponible", origen: "sede-a", demoraDias: null });
  });

  it("demora 0 se informa como 0 (a coordinar), no como null", () => {
    const r = disponibilidadPorSucursal({
      ...base,
      reglas: { trasladoDias: 0 },
      stockPorSucursal: { P: { "sede-b": 1 } },
    });
    expect(r.productos.P.envio?.demoraDias).toBe(0);
  });

  it("respeta la cantidad pedida", () => {
    const r = disponibilidadPorSucursal({
      ...base,
      stockPorSucursal: { P: { "sede-a": 2, "sede-b": 5 } },
      cantidades: { P: 3 },
    });
    expect(r.productos.P.envio).toEqual({ estado: "a_traer", origen: "sede-b", demoraDias: 7 });
  });

  it("es determinista y no muta la entrada", () => {
    const entrada = { ...base, stockPorSucursal: { B: { "sede-b": 1 }, A: { "sede-a": 1 } } };
    const copia = structuredClone(entrada);
    const a = disponibilidadPorSucursal(entrada);
    expect(JSON.stringify(a)).toBe(JSON.stringify(disponibilidadPorSucursal(entrada)));
    expect(entrada).toEqual(copia);
    expect(Object.keys(a.productos)).toEqual(["A", "B"]);
  });
});

describe("disponibilidadPorSucursal: retiro por local", () => {
  const retiro = { ...base, modalidad: "retiro" as const };

  it("un ítem por local que acepta retiro; sin stock local se ofrece con demora, no se bloquea", () => {
    const r = disponibilidadPorSucursal({ ...retiro, stockPorSucursal: { P: { "sede-a": 0, "sede-b": 3 } } });
    expect(r.productos.P.envio).toBeNull();
    expect(r.productos.P.retiro).toEqual({
      "sede-a": { estado: "con_demora", desde: "sede-b", demoraDias: 7 },
      "sede-b": { estado: "disponible", desde: null, demoraDias: null },
    });
    expect(r.lineasATraer).toEqual([]);
  });

  it("demora 0 = a coordinar", () => {
    const r = disponibilidadPorSucursal({
      ...retiro,
      reglas: { trasladoDias: 0 },
      stockPorSucursal: { P: { "sede-b": 3 } },
    });
    expect(r.productos.P.retiro?.["sede-a"]).toEqual({ estado: "con_demora", desde: "sede-b", demoraDias: 0 });
  });

  it("oculto en un local: no se ofrece ahí y esa sucursal tampoco sirve de respaldo", () => {
    const r = disponibilidadPorSucursal({
      ...retiro,
      stockPorSucursal: { P: { "sede-a": 5, "sede-b": 5 } },
      ocultoEn: { P: ["sede-b"] },
    });
    expect(r.productos.P.retiro?.["sede-b"]).toEqual({ estado: "oculto", desde: null, demoraDias: null });
    expect(r.productos.P.retiro?.["sede-a"]?.estado).toBe("disponible");
  });

  it("oculto en el local de respaldo: el otro local queda sin stock", () => {
    const r = disponibilidadPorSucursal({
      ...retiro,
      stockPorSucursal: { P: { "sede-b": 5 } },
      ocultoEn: { P: ["sede-b"] },
    });
    expect(r.productos.P.retiro?.["sede-a"]?.estado).toBe("sin_stock");
  });

  it("un local que no acepta retiro o está inactivo no aparece", () => {
    const sin = sucursales.map((s) => (s.slug === "sede-a" ? { ...s, aceptaRetiro: false } : s));
    const r = disponibilidadPorSucursal({ ...retiro, sucursales: sin, stockPorSucursal: { P: { "sede-b": 1 } } });
    expect(Object.keys(r.productos.P.retiro ?? {})).toEqual(["sede-b"]);
  });
});

describe("reglas de respaldo (respaldo_envio y retiro_sin_stock)", () => {
  const stockPorSucursal = { P: { "sede-a": 0, "sede-b": 4 } };

  it("envío sin respaldo: sin stock en la zona no sale de la otra sucursal", () => {
    const r = disponibilidadPorSucursal({
      ...base,
      stockPorSucursal,
      reglas: { trasladoDias: 7, respaldoEnvio: false },
    });
    expect(r.productos.P.envio).toEqual({ estado: "sin_stock", origen: null, demoraDias: null });
    expect(r.productos.P.servible).toBe(true);
    expect(r.lineasATraer).toEqual([]);
  });

  it("retiro que se bloquea sin stock local: no se ofrece con demora", () => {
    const r = disponibilidadPorSucursal({
      ...base,
      modalidad: "retiro",
      stockPorSucursal,
      reglas: { trasladoDias: 7, retiroSinStock: "bloquear" },
    });
    expect(r.productos.P.retiro?.["sede-a"].estado).toBe("sin_stock");
    expect(r.productos.P.retiro?.["sede-b"].estado).toBe("disponible");
  });

  it("los defaults (sin los campos) ofrecen respaldo en envío y retiro con demora", () => {
    const envio = disponibilidadPorSucursal({ ...base, stockPorSucursal });
    expect(envio.productos.P.envio?.estado).toBe("a_traer");
    const retiro = disponibilidadPorSucursal({ ...base, modalidad: "retiro", stockPorSucursal });
    expect(retiro.productos.P.retiro?.["sede-a"].estado).toBe("con_demora");
  });
});

describe("armarStockPorSucursal", () => {
  const slugs = ["sede-a", "sede-b"];
  it("con filas por sucursal manda el detalle y la que falta vale 0", () => {
    const r = armarStockPorSucursal([{ alegraId: "1", stock: 9 }], [{ alegraId: "1", sucursal: "sede-b", stock: 3 }], slugs, "sede-a");
    expect(r["1"]).toEqual({ "sede-a": 0, "sede-b": 3 });
  });
  it("sin ninguna fila, el stock de la vista es de la sucursal heredera", () => {
    const r = armarStockPorSucursal([{ alegraId: "1", stock: 9 }], [], slugs, "sede-a");
    expect(r["1"]).toEqual({ "sede-a": 9, "sede-b": 0 });
  });
  it("no inventariable (stock null) queda null aunque haya filas", () => {
    const r = armarStockPorSucursal([{ alegraId: "1", stock: null }], [{ alegraId: "1", sucursal: "sede-a", stock: 2 }], slugs, "sede-a");
    expect(r["1"]).toBeNull();
  });
});
