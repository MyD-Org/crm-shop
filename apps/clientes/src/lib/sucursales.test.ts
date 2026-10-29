import { describe, expect, it } from "vitest";
import casos from "./__fixtures__/sucursales-casos.json";
import {
  asignarSucursal,
  claveProvincia,
  origenDeLinea,
  resolverZona,
  type StockFn,
  type SucursalDato,
  type ZonaDato,
} from "./sucursales";
import { PROVINCIAS_AR } from "./provincias";

type Dataset = { sucursales: SucursalDato[]; zonas: ZonaDato[] };
const datasets = casos.datasets as Record<string, Dataset>;

describe("resolverZona (fixture compartido con el CRM)", () => {
  for (const c of casos.resolverZona) {
    it(c.caso, () => {
      const d = datasets[c.dataset];
      expect(resolverZona(c.provincia, d.zonas, d.sucursales)).toEqual(c.esperado);
    });
  }
});

describe("asignarSucursal (fixture compartido con el CRM)", () => {
  for (const c of casos.asignarSucursal) {
    it(c.caso, () => {
      const d = datasets[c.dataset];
      expect(asignarSucursal(c.entrada as never, d)).toEqual(c.esperado);
    });
  }
});

describe("determinismo", () => {
  it("las mismas reglas y la misma entrada dan exactamente el mismo resultado", () => {
    const d = datasets.base;
    const entrada = { entregaTipo: "envio" as const, provincia: "Misiones", ciudad: "Puerto Iguazú" };
    const a = asignarSucursal(entrada, d);
    const b = asignarSucursal(entrada, d);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("no depende del orden en que vienen las sucursales ni las zonas", () => {
    const d = datasets.zona_inactiva;
    const invertido = { sucursales: [...d.sucursales].reverse(), zonas: [...d.zonas].reverse() };
    const entrada = { entregaTipo: "envio" as const, provincia: "Córdoba", ciudad: "Córdoba" };
    expect(asignarSucursal(entrada, invertido)).toEqual(asignarSucursal(entrada, d));
  });

  it("no muta los datos de entrada", () => {
    const d = structuredClone(datasets.base);
    asignarSucursal({ entregaTipo: "envio", provincia: "Misiones", ciudad: "El Dorado" }, d);
    expect(d).toEqual(datasets.base);
  });
});

describe("claveProvincia", () => {
  it("normaliza acentos, mayúsculas, espacios y alias de CABA", () => {
    expect(claveProvincia(" TUCUMÁN ")).toBe("tucuman");
    expect(claveProvincia("Entre Rios")).toBe(claveProvincia("Entre Ríos"));
    expect(claveProvincia("Capital Federal")).toBe("ciudadautonomadebuenosaires");
    expect(claveProvincia("CABA")).toBe("ciudadautonomadebuenosaires");
  });

  it("todas las jurisdicciones tienen clave y no se pisan", () => {
    const claves = PROVINCIAS_AR.map((p) => claveProvincia(p));
    expect(claves.every(Boolean)).toBe(true);
    expect(new Set(claves).size).toBe(24);
  });

  it("un texto que no es una provincia da clave vacía y cae en el default", () => {
    expect(claveProvincia("Narnia")).toBe("");
    expect(claveProvincia("")).toBe("");
    expect(claveProvincia(null)).toBe("");
  });
});

describe("venta sin stock por modalidad (línea por pedido)", () => {
  const suc = (slug: string, orden: number, extra: Partial<SucursalDato> = {}): SucursalDato => ({
    slug,
    aceptaRetiro: true,
    aceptaEnvio: true,
    envioCiudades: [],
    orden,
    activa: true,
    predeterminada: orden === 1,
    ...extra,
  });
  const SUCS: SucursalDato[] = [suc("igz", 1), suc("mdp", 2)];
  const ZONAS: ZonaDato[] = [{ id: "z1", provinciaClave: "misiones", sucursal: "igz", facturaSucursal: null }];
  const fnStock =
    (porSucursal: Record<string, Record<string, number | null>>): StockFn =>
    (sucursal, id) => {
      const v = porSucursal[sucursal]?.[id];
      return v === undefined ? 0 : v;
    };

  describe("stock en otra sucursal, traslado on/off", () => {
    const stock = fnStock({ igz: { p1: 0 }, mdp: { p1: 5 } });
    it("con respaldo, manda el traslado aunque tenga modalidad", () =>
      expect(origenDeLinea({ id: "p1", qty: 1, ocultoEn: [], porPedido: true }, "igz", SUCS, stock, true)).toEqual({
        origen: "mdp",
        aTraer: true,
      }));
    it("sin respaldo y sin stock en la elegida: por pedido", () =>
      expect(origenDeLinea({ id: "p1", qty: 1, ocultoEn: [], porPedido: true }, "igz", SUCS, stock, false)).toEqual({
        origen: "igz",
        aTraer: false,
        porPedido: true,
      }));
    it("sin modalidad, sin_stock como hoy", () =>
      expect(origenDeLinea({ id: "p1", qty: 1, ocultoEn: [] }, "igz", SUCS, stock, false)).toEqual({ error: "sin_stock" }));
  });

  it("con stock propio, la modalidad no cambia nada", () =>
    expect(
      origenDeLinea({ id: "p1", qty: 1, ocultoEn: [], porPedido: true }, "igz", SUCS, fnStock({ igz: { p1: 3 } })),
    ).toEqual({ origen: "igz", aTraer: false }));

  it("sin stock en ninguna, con respaldo: por pedido desde la preferida", () =>
    expect(origenDeLinea({ id: "p1", qty: 1, ocultoEn: [], porPedido: true }, "igz", SUCS, fnStock({}))).toEqual({
      origen: "igz",
      aTraer: false,
      porPedido: true,
    }));

  it("la preferida oculta o inactiva no es candidata: sin_stock; oculta en todas: no_servible", () => {
    const sinStock = fnStock({});
    expect(origenDeLinea({ id: "p1", qty: 1, ocultoEn: ["igz"], porPedido: true }, "igz", SUCS, sinStock)).toEqual({
      error: "sin_stock",
    });
    const inactiva = [suc("igz", 1, { activa: false }), suc("mdp", 2)];
    expect(origenDeLinea({ id: "p1", qty: 1, ocultoEn: [], porPedido: true }, "igz", inactiva, sinStock)).toEqual({
      error: "sin_stock",
    });
    expect(
      origenDeLinea({ id: "p1", qty: 1, ocultoEn: ["igz", "mdp"], porPedido: true }, "igz", SUCS, sinStock),
    ).toEqual({ error: "no_servible" });
  });

  it("asignarSucursal: la línea por pedido sale de la sucursal del pedido y no es 'a traer'", () => {
    const stock = fnStock({ igz: { p1: 0, p2: 4 }, mdp: { p1: 0, p2: 0 } });
    const r = asignarSucursal(
      {
        entregaTipo: "envio",
        provincia: "Misiones",
        lineas: [
          { id: "p1", qty: 2, ocultoEn: [], porPedido: true },
          { id: "p2", qty: 1, ocultoEn: [] },
        ],
      },
      { sucursales: SUCS, zonas: ZONAS, reglas: { trasladoDias: 7, respaldoEnvio: false } },
      stock,
    );
    expect(r).toEqual({
      sucursal: "igz",
      regla: {
        v: 1,
        regla: "zona:misiones",
        motivo: "zona",
        provincia: "misiones",
        zonaId: "z1",
        sucursalZona: "igz",
        facturaSucursal: null,
        lineasATraer: [],
      },
      lineas: [
        { id: "p1", origen: "igz" },
        { id: "p2", origen: "igz" },
      ],
      demoraDias: null,
    });
  });

  it("asignarSucursal en retiro: sin modalidad sigue siendo sin_stock", () => {
    const r = asignarSucursal(
      { entregaTipo: "retiro", sucursalRetiro: "mdp", lineas: [{ id: "p1", qty: 1, ocultoEn: [] }] },
      { sucursales: SUCS, zonas: ZONAS, reglas: { trasladoDias: 7, retiroSinStock: "bloquear" } },
      fnStock({ igz: { p1: 5 } }),
    );
    expect(r).toEqual({ error: "sin_stock", ids: ["p1"] });
  });
});
