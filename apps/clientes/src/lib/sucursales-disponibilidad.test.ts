import { describe, expect, it } from "vitest";
import casos from "./__fixtures__/sucursales-lineas-casos.json";
import type { ReglasVenta, SucursalDato } from "./sucursales";
import {
  armarStockPorSucursal,
  conTramosPorCantidad,
  disponibilidadAmbas,
  disponibilidadPorSucursal,
  disponibleNeto,
  umbralesDeCantidad,
  unidadesPorSucursal,
} from "./sucursales-disponibilidad";
import type { VentaSinStock } from "./venta-sin-stock";

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
  it("el plazo de despacho sale de las reglas: días configurados, null si está oculto", () => {
    const stockPorSucursal = { P: { "sede-a": 2 }, Q: { "sede-b": 1 } };
    const r = disponibilidadPorSucursal({
      ...base,
      reglas: { ...reglas, despacho: { visible: true, diasHabiles: 3 } },
      stockPorSucursal,
    });
    expect(r.productos.P.envio?.despachoDias).toBe(3);
    expect(r.productos.Q.envio?.despachoDias).toBe(3);
    const oculto = disponibilidadPorSucursal({
      ...base,
      reglas: { ...reglas, despacho: { visible: false, diasHabiles: 3 } },
      stockPorSucursal,
    });
    expect(oculto.productos.P.envio?.despachoDias).toBeNull();
    expect(oculto.productos.Q.envio).toMatchObject({ estado: "a_traer", demoraDias: 7, despachoDias: null });
  });

  it("sin stock en la zona el producto sigue visible: sale de la otra sucursal, a traer", () => {
    const r = disponibilidadPorSucursal({ ...base, stockPorSucursal: { P: { "sede-a": 0, "sede-b": 4 } } });
    expect(r.productos.P.servible).toBe(true);
    expect(r.productos.P.envio).toEqual({ estado: "a_traer", origen: "sede-b", demoraDias: 7, despachoDias: 1 });
    expect(r.productos.P.retiro).toBeNull();
    expect(r.lineasATraer).toEqual(["P"]);
  });

  it("con stock en el origen: disponible, sin traslado", () => {
    const r = disponibilidadPorSucursal({ ...base, stockPorSucursal: { P: { "sede-a": 2 } } });
    expect(r.productos.P.envio).toEqual({ estado: "disponible", origen: "sede-a", demoraDias: null, despachoDias: 1 });
    expect(r.lineasATraer).toEqual([]);
  });

  it("la reserva de la sucursal cuenta: 3 en stock y 3 reservadas es sin stock allá", () => {
    const r = disponibilidadPorSucursal({
      ...base,
      stockPorSucursal: { P: { "sede-a": 3, "sede-b": 1 } },
      reservadoPorSucursal: { P: { "sede-a": 3 } },
    });
    expect(r.productos.P.envio).toEqual({ estado: "a_traer", origen: "sede-b", demoraDias: 7, despachoDias: 1 });
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
    expect(r.productos.P.envio).toEqual({ estado: "a_traer", origen: "sede-b", demoraDias: 7, despachoDias: 1 });
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
    expect(r.productos.N.envio).toEqual({ estado: "disponible", origen: "sede-a", demoraDias: null, despachoDias: 1 });
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
    expect(r.productos.P.envio).toEqual({ estado: "a_traer", origen: "sede-b", demoraDias: 7, despachoDias: 1 });
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

describe("venta sin stock por modalidad (por_pedido)", () => {
  const M: VentaSinStock = { id: "m1", texto: "Modalidad 48 h", plazoDias: 2, flujo: "en_linea" };
  const ENTRADA = { ...base, stockPorSucursal: { p1: { "sede-a": 0, "sede-b": 0 } } };

  it("envío sin stock con modalidad → por_pedido con el plazo (null → 0)", () => {
    const r = disponibilidadPorSucursal({ ...ENTRADA, ventaSinStock: { p1: { ...M, plazoDias: null } } });
    expect(r.productos.p1.envio).toMatchObject({ estado: "por_pedido", demoraDias: 0 });
    expect(r.lineasATraer).toEqual([]);
  });

  it("envío por_pedido: sale de la zona, con el plazo de la modalidad y el despacho", () => {
    const r = disponibilidadPorSucursal({ ...ENTRADA, ventaSinStock: { p1: M } });
    expect(r.productos.p1.envio).toEqual({ estado: "por_pedido", origen: "sede-a", demoraDias: 2, despachoDias: 1 });
    expect(r.productos.p1.servible).toBe(true);
  });

  it("sin modalidad: sin_stock, igual que hoy", () => {
    const r = disponibilidadPorSucursal({ ...ENTRADA, ventaSinStock: {} });
    expect(r.productos.p1.envio).toEqual({ estado: "sin_stock", origen: null, demoraDias: null });
    expect(disponibilidadPorSucursal(ENTRADA)).toEqual(r);
  });

  it("con stock en otra sucursal y respaldo, manda el traslado; sin respaldo, por_pedido", () => {
    const stockPorSucursal = { p1: { "sede-a": 0, "sede-b": 4 } };
    const con = disponibilidadPorSucursal({ ...base, stockPorSucursal, ventaSinStock: { p1: M } });
    expect(con.productos.p1.envio?.estado).toBe("a_traer");
    expect(con.lineasATraer).toEqual(["p1"]);
    const sin = disponibilidadPorSucursal({
      ...base,
      stockPorSucursal,
      reglas: { trasladoDias: 7, respaldoEnvio: false },
      ventaSinStock: { p1: M },
    });
    expect(sin.productos.p1.envio?.estado).toBe("por_pedido");
    expect(sin.lineasATraer).toEqual([]);
  });

  it("con stock propio la modalidad no cambia nada", () => {
    const r = disponibilidadPorSucursal({ ...base, stockPorSucursal: { p1: { "sede-a": 3 } }, ventaSinStock: { p1: M } });
    expect(r.productos.p1.envio).toEqual({ estado: "disponible", origen: "sede-a", demoraDias: null, despachoDias: 1 });
  });

  it("la cantidad pedida mayor al stock pasa la línea a pedido", () => {
    const r = disponibilidadPorSucursal({
      ...base,
      stockPorSucursal: { p1: { "sede-a": 2, "sede-b": 2 } },
      cantidades: { p1: 3 },
      ventaSinStock: { p1: M },
    });
    expect(r.productos.p1.envio?.estado).toBe("por_pedido");
  });

  it("retiro: por local; con traslado manda con_demora, sin él por_pedido; oculto sigue oculto", () => {
    const retiro = { ...base, modalidad: "retiro" as const, ventaSinStock: { p1: M } };
    const r = disponibilidadPorSucursal({ ...retiro, stockPorSucursal: { p1: { "sede-b": 3 } } });
    expect(r.productos.p1.retiro).toEqual({
      "sede-a": { estado: "con_demora", desde: "sede-b", demoraDias: 7 },
      "sede-b": { estado: "disponible", desde: null, demoraDias: null },
    });
    const bloqueado = disponibilidadPorSucursal({
      ...retiro,
      reglas: { trasladoDias: 7, retiroSinStock: "bloquear" },
      stockPorSucursal: { p1: { "sede-b": 3 } },
    });
    expect(bloqueado.productos.p1.retiro?.["sede-a"]).toEqual({ estado: "por_pedido", desde: null, demoraDias: 2 });
    const oculto = disponibilidadPorSucursal({ ...retiro, stockPorSucursal: { p1: {} }, ocultoEn: { p1: ["sede-a"] } });
    expect(oculto.productos.p1.retiro).toEqual({
      "sede-a": { estado: "oculto", desde: null, demoraDias: null },
      "sede-b": { estado: "por_pedido", desde: null, demoraDias: 2 },
    });
  });

  it("un id que sólo viene en la modalidad no inventa un producto", () => {
    const r = disponibilidadPorSucursal({ ...base, stockPorSucursal: {}, ventaSinStock: { p9: M } });
    expect(r.productos).toEqual({});
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

describe("tramos por cantidad (ficha)", () => {
  // sede-b es la zona y su local: 2 ahí y 21 en sede-a (el caso de una fuente en MdP e Iguazú).
  const entrada = {
    sucursales,
    zona: "sede-b",
    reglas: reglas as ReglasVenta,
    reservadoPorSucursal: {},
    ocultoEn: {},
    stockPorSucursal: { P: { "sede-a": 21, "sede-b": 2 } } as Record<string, Record<string, number> | null>,
  };
  const conTramos = (e: typeof entrada) => conTramosPorCantidad(e, disponibilidadAmbas(e).productos);

  it("umbrales: una más que las unidades de cada sucursal, desde 2, sin repetir", () => {
    expect(umbralesDeCantidad({ "sede-a": 21, "sede-b": 2 })).toEqual([3, 22]);
    expect(umbralesDeCantidad({ "sede-a": 0, "sede-b": 5 })).toEqual([6]);
    expect(umbralesDeCantidad({ "sede-a": 4, "sede-b": 4 })).toEqual([5]);
    expect(umbralesDeCantidad({})).toEqual([]);
  });

  it("unidades netas de reserva por sucursal activa, sin las ocultas; null si no es inventariable", () => {
    expect(unidadesPorSucursal({ ...entrada, reservadoPorSucursal: { P: { "sede-b": 1 } } }, "P")).toEqual({
      "sede-a": 21,
      "sede-b": 1,
    });
    expect(unidadesPorSucursal({ ...entrada, ocultoEn: { P: ["sede-a"] } }, "P")).toEqual({ "sede-b": 2 });
    expect(unidadesPorSucursal({ ...entrada, stockPorSucursal: { P: null } }, "P")).toBeNull();
  });

  it("el local cubre hasta sus unidades; más que eso la línea entera viene de la otra sucursal", () => {
    const p = conTramos(entrada).P;
    expect(p.unidades).toEqual({ "sede-a": 21, "sede-b": 2 });
    expect(p.retiro?.["sede-b"].estado).toBe("disponible");
    expect(p.envio?.estado).toBe("disponible");
    expect(p.tramos?.map((t) => t.desde)).toEqual([3, 22]);
    const [tres, masDelMaximo] = p.tramos!;
    expect(tres.retiro?.["sede-b"]).toEqual({ estado: "con_demora", desde: "sede-a", demoraDias: 7 });
    expect(tres.retiro?.["sede-a"].estado).toBe("disponible");
    expect(tres.envio).toMatchObject({ estado: "a_traer", origen: "sede-a", demoraDias: 7 });
    expect(masDelMaximo.retiro?.["sede-b"].estado).toBe("sin_stock");
    expect(masDelMaximo.envio?.estado).toBe("sin_stock");
  });

  it("sin respaldo (retiro bloqueado y envío sin respaldo) pasar las unidades del local es sin stock", () => {
    const p = conTramos({ ...entrada, reglas: { ...reglas, respaldoEnvio: false, retiroSinStock: "bloquear" as const } }).P;
    expect(p.tramos?.[0].retiro?.["sede-b"].estado).toBe("sin_stock");
    expect(p.tramos?.[0].envio?.estado).toBe("sin_stock");
  });

  it("oculto en una sucursal: no cuenta en las unidades ni en los umbrales", () => {
    const p = conTramos({ ...entrada, ocultoEn: { P: ["sede-a"] } }).P;
    expect(p.unidades).toEqual({ "sede-b": 2 });
    expect(p.tramos?.map((t) => t.desde)).toEqual([3]);
    expect(p.tramos?.[0].retiro?.["sede-b"].estado).toBe("sin_stock");
  });

  it("no inventariable: sin tramos (siempre disponible)", () => {
    const p = conTramos({ ...entrada, stockPorSucursal: { P: null } }).P;
    expect(p.unidades).toBeNull();
    expect(p.tramos).toBeUndefined();
    expect(p.retiro?.["sede-b"].estado).toBe("disponible");
  });

  it("con modalidad de venta sin stock, pasar el máximo es por pedido", () => {
    const venta: VentaSinStock = { id: "m", texto: "A pedido", plazoDias: 10, flujo: "en_linea" };
    const p = conTramos({ ...entrada, ventaSinStock: { P: venta } } as typeof entrada).P;
    expect(p.tramos?.at(-1)?.desde).toBe(22);
    expect(p.tramos?.at(-1)?.retiro?.["sede-b"]).toEqual({ estado: "por_pedido", desde: null, demoraDias: 10 });
    expect(p.tramos?.at(-1)?.envio?.estado).toBe("por_pedido");
  });

  it("los tramos de un producto no cambian la vista de los otros", () => {
    const e = { ...entrada, stockPorSucursal: { P: { "sede-a": 21, "sede-b": 2 }, Q: { "sede-b": 1 } } };
    const r = conTramos(e);
    expect(r.Q.tramos?.map((t) => t.desde)).toEqual([2]);
    expect(r.Q.retiro?.["sede-b"].estado).toBe("disponible");
    expect(r.P.tramos?.map((t) => t.desde)).toEqual([3, 22]);
  });
});
