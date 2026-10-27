import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatosSucursales, ReglasVentaTenant } from "./sucursales-repo";
import type { DisponibilidadBruta } from "./stock-sucursal";
import type { ModalidadSinStock, VentaSinStock } from "./venta-sin-stock";

/**
 * `crearPedido` con el flag `disponibilidad-sucursal`: dentro de la transacción toma los locks por
 * ítem, relee sucursales, reglas y stock por sucursal, asigna el origen de cada línea y congela
 * `reserva_vence_en` y `order_items.a_traer_de`. Sin stock / oculto: 409 en usted y no se escribe nada.
 */
const eventos: string[] = [];
const valoresPedido: Record<string, unknown>[] = [];
const valoresItems: Record<string, unknown>[][] = [];
let existente: unknown[] = [];
let datos: DatosSucursales;
let reglas: ReglasVentaTenant;
let bruta: DisponibilidadBruta;
const leerReglas = vi.fn(async () => reglas);
const leerBruta = vi.fn(async () => bruta);

const tx = {
  // Savepoint (`tx.transaction`): el ejecutor anidado es el mismo mock.
  transaction: async (cb: (t: unknown) => unknown) => cb(tx),
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => existente }) }),
  }),
  execute: async () => {
    eventos.push("lock");
  },
  insert: () => ({
    values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
      if (Array.isArray(v)) {
        valoresItems.push(v);
        eventos.push("items");
        return { then: (ok: (v: unknown) => void) => ok(undefined) };
      }
      valoresPedido.push(v);
      eventos.push("pedido");
      return {
        onConflictDoNothing: () => ({
          returning: async () => [
            { id: "ped-1", numero: 1000, cuotas: null },
          ],
        }),
      };
    },
  }),
};
vi.mock("@/db", () => ({
  getDb: () => ({ transaction: (cb: (t: unknown) => unknown) => cb(tx) }),
}));
vi.mock("./sucursales-repo", () => ({
  leerSucursalesYZonas: async () => datos,
  leerReglasVenta: (...a: unknown[]) => leerReglas(...(a as [])),
}));
vi.mock("./stock-sucursal", () => ({
  leerDisponibilidadBruta: (...a: unknown[]) => leerBruta(...(a as [])),
}));
const disponiblesLegacy = vi.fn(
  async () => new Map<string, number | null>([["1", null]]),
);
vi.mock("./stock-disponible", async (orig) => ({
  ...(await orig<typeof import("./stock-disponible")>()),
  disponiblesEnTx: (...a: unknown[]) => disponiblesLegacy(...(a as [])),
}));
vi.mock("./carrito-db", () => ({ vaciarCarritoTx: async () => {} }));
vi.mock("./catalog", () => ({ getProductosPorIds: async () => [] }));
vi.mock("./tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));
let modalidades: ModalidadSinStock[] = [];
const leerModalidades = vi.fn<(db?: unknown) => Promise<ModalidadSinStock[]>>(async () => modalidades);
vi.mock("./venta-sin-stock-repo", () => ({
  leerModalidadesActivas: (db?: unknown) => leerModalidades(db),
}));

import {
  calcularReservaVenceEn,
  crearPedido,
  type DatosPedido,
  VENTANA_PAGO_MS,
} from "./pedidos";
import { SucursalPedidoError } from "./sucursales-pedido";
import { StockInsuficienteError } from "./stock-disponible";
import { VentaSinStockCambioError } from "./venta-sin-stock";

/** Texto de un valor `sql\`...\`` de drizzle (para verificar el literal `'infinity'`). */
const sqlTexto = (v: unknown): string =>
  JSON.stringify((v as { queryChunks?: unknown[] } | null)?.queryChunks ?? v);

const linea = (id: string, qty = 1) => ({
  id,
  code: `C${id}`,
  name: `Producto ${id}`,
  brand: "",
  qty,
  precioUnitario: 100,
  ivaPorcentaje: 21,
  subtotal: 100 * qty,
  iva: 21 * qty,
  total: 121 * qty,
});
const cotizacion = (...lineas: ReturnType<typeof linea>[]) =>
  ({
    lineas,
    hayProblemas: false,
    subtotal: 100,
    iva: 21,
    costoEnvio: 0,
    total: 121,
  }) as never;

const MODALIDAD_EN_LINEA: ModalidadSinStock = {
  id: "mod-48",
  nombre: "Modalidad 48 h",
  texto: "Retiro en ~48 h",
  plazoDias: 2,
  flujo: "en_linea",
};
const MODALIDAD_A_CONFIRMAR: ModalidadSinStock = {
  id: "mod-pedido",
  nombre: "A pedido interno",
  texto: "A pedido",
  plazoDias: null,
  flujo: "a_confirmar",
};
/** Lo que la cotización deja en una línea a pedido (sin el `nombre` interno). */
const venta = (m: ModalidadSinStock): VentaSinStock => ({
  id: m.id,
  texto: m.texto,
  plazoDias: m.plazoDias,
  flujo: m.flujo,
});
const lineaAPedido = (id: string, m: ModalidadSinStock = MODALIDAD_EN_LINEA, qty = 1) => ({
  ...linea(id, qty),
  ventaSinStock: venta(m),
  aceptaSinStock: true as const,
});

const suc = (slug: string, orden: number, extra = {}) => ({
  slug,
  nombre: slug,
  ciudad: "x",
  provincia: "x",
  direccion: "x",
  horario: "x",
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden,
  activa: true,
  predeterminada: false,
  ...extra,
});

const base: DatosPedido = {
  contactoNombre: "Persona Ejemplo",
  contactoTelefono: "0000",
  entregaTipo: "envio",
  entregaCiudad: "Ciudad Ejemplo",
  pagoMetodo: "a_coordinar",
  disponibilidadSucursal: true,
  sucursalEntrada: {
    entregaTipo: "envio",
    provincia: "misiones",
    ciudad: "Ciudad Ejemplo",
  },
};
const crear = (extra: Partial<DatosPedido> = {}, c = cotizacion(linea("1"))) =>
  crearPedido({ clerkUserId: "user_1" }, { ...base, ...extra }, c);

beforeEach(() => {
  eventos.length = 0;
  valoresPedido.length = 0;
  valoresItems.length = 0;
  existente = [];
  leerReglas.mockClear();
  leerBruta.mockClear();
  disponiblesLegacy.mockClear();
  modalidades = [MODALIDAD_EN_LINEA, MODALIDAD_A_CONFIRMAR];
  leerModalidades.mockClear();
  datos = {
    sucursales: [suc("sede-a", 1), suc("sede-b", 2, { predeterminada: true })],
    zonas: [
      {
        id: "z1",
        provinciaClave: "misiones",
        sucursal: "sede-a",
        facturaSucursal: null,
      },
    ],
  } as DatosSucursales;
  reglas = {
    respaldoEnvio: true,
    retiroSinStock: "ofrecer",
    trasladoDias: 7,
    reservaDias: 7,
    avisoSinContactarHoras: 24,
    contactoHorasHabiles: 24,
  };
  bruta = {
    stockPorSucursal: { "1": { "sede-a": 5, "sede-b": 5 } },
    reservadoPorSucursal: {},
    ocultoEn: {},
    ventaSinStock: {},
  };
});

describe("crearPedido con disponibilidad por sucursal", () => {
  it("valida con los locks por ítem ANTES de escribir el pedido y no usa la vista 0012", async () => {
    await crear();
    expect(eventos).toEqual(["lock", "pedido", "items"]);
    expect(disponiblesLegacy).not.toHaveBeenCalled();
    expect(leerReglas).toHaveBeenCalledWith(tx);
    expect(leerBruta).toHaveBeenCalledWith(
      ["1"],
      ["sede-a", "sede-b"],
      "sede-a",
      tx,
    );
    expect(valoresPedido[0]).toMatchObject({ sucursal: "sede-a" });
    expect(valoresItems[0][0]).toMatchObject({
      alegraItemId: "1",
      aTraerDe: null,
    });
  });

  it("línea sin stock en la sucursal de la zona: sale de la otra y se marca 'a traer'", async () => {
    bruta.stockPorSucursal = {
      "1": { "sede-a": 0, "sede-b": 3 },
      "2": { "sede-a": 4, "sede-b": 0 },
    };
    await crear({}, cotizacion(linea("1"), linea("2")));
    expect(valoresPedido[0]).toMatchObject({ sucursal: "sede-a" });
    expect(valoresPedido[0].sucursalRegla).toMatchObject({
      lineasATraer: ["1"],
    });
    const items = valoresItems[0];
    expect(items.find((i) => i.alegraItemId === "1")).toMatchObject({
      aTraerDe: "sede-b",
    });
    expect(items.find((i) => i.alegraItemId === "2")).toMatchObject({
      aTraerDe: null,
    });
  });

  it("la reserva de otros pedidos en la sucursal cuenta (3 en stock, 3 reservadas = sin stock allá)", async () => {
    bruta.stockPorSucursal = { "1": { "sede-a": 3, "sede-b": 2 } };
    bruta.reservadoPorSucursal = { "1": { "sede-a": 3 } };
    await crear();
    expect(valoresItems[0][0]).toMatchObject({ aTraerDe: "sede-b" });
  });

  it("congela reserva_vence_en = ahora + reserva_dias", async () => {
    const antes = Date.now();
    await crear();
    const vence = (valoresPedido[0].reservaVenceEn as Date).getTime();
    expect(vence - antes).toBeGreaterThanOrEqual(7 * 24 * 60 * 60_000 - 5);
    expect(vence - antes).toBeLessThan(7 * 24 * 60 * 60_000 + 5_000);
  });

  it("reserva_dias 0: nunca vence ('infinity', nunca NULL)", async () => {
    reglas.reservaDias = 0;
    await crear();
    expect(sqlTexto(valoresPedido[0].reservaVenceEn)).toContain("infinity");
  });

  it("pago online (Mercado Pago) conserva su ventana de 24 h", async () => {
    const antes = Date.now();
    await crear({ pagoMetodo: "mercadopago" });
    const vence = (valoresPedido[0].reservaVenceEn as Date).getTime();
    expect(vence - antes).toBeGreaterThanOrEqual(VENTANA_PAGO_MS - 5);
    expect(vence - antes).toBeLessThan(VENTANA_PAGO_MS + 5_000);
  });

  it("sin stock en ninguna sucursal: sin_stock (con los ids) y no escribe ningún pedido", async () => {
    bruta.stockPorSucursal = { "1": { "sede-a": 0, "sede-b": 0 } };
    const err = await crear().catch((e) => e);
    expect(err).toBeInstanceOf(SucursalPedidoError);
    expect(err).toMatchObject({ codigo: "sin_stock", ids: ["1"] });
    expect(valoresPedido).toHaveLength(0);
  });

  it("oculto en todas las sucursales: no_servible en usted", async () => {
    bruta.ocultoEn = { "1": ["sede-a", "sede-b"] };
    const err = await crear().catch((e) => e);
    expect(err).toMatchObject({
      codigo: "no_servible",
      ids: ["1"],
      message: "El producto ya no está disponible.",
    });
  });

  it("retiro en un local donde el producto está oculto: sin_retiro con los ids", async () => {
    bruta.ocultoEn = { "1": ["sede-b"] };
    const err = await crear({
      entregaTipo: "retiro",
      sucursalEntrada: { entregaTipo: "retiro", sucursalRetiro: "sede-b" },
    }).catch((e) => e);
    expect(err).toMatchObject({ codigo: "sin_retiro", ids: ["1"] });
    expect(err.message).toMatch(/retiro en el local seleccionado/);
  });

  it("retiro sin stock local y con stock en la otra: se ofrece trayéndolo (regla retiro_sin_stock)", async () => {
    bruta.stockPorSucursal = { "1": { "sede-a": 0, "sede-b": 5 } };
    await crear({
      entregaTipo: "retiro",
      sucursalEntrada: { entregaTipo: "retiro", sucursalRetiro: "sede-a" },
    });
    expect(valoresPedido[0]).toMatchObject({ sucursal: "sede-a" });
    expect(valoresItems[0][0]).toMatchObject({ aTraerDe: "sede-b" });
  });

  it("retiro con retiro_sin_stock = bloquear: sin stock local no se ofrece", async () => {
    reglas.retiroSinStock = "bloquear";
    bruta.stockPorSucursal = { "1": { "sede-a": 0, "sede-b": 5 } };
    const err = await crear({
      entregaTipo: "retiro",
      sucursalEntrada: { entregaTipo: "retiro", sucursalRetiro: "sede-a" },
    }).catch((e) => e);
    expect(err).toMatchObject({ codigo: "sin_stock" });
  });

  it("envío con respaldo apagado: sin stock en la zona no sale de la otra", async () => {
    reglas.respaldoEnvio = false;
    bruta.stockPorSucursal = { "1": { "sede-a": 0, "sede-b": 5 } };
    const err = await crear().catch((e) => e);
    expect(err).toMatchObject({ codigo: "sin_stock" });
  });

  it("un producto que ya no está en el espejo tira StockInsuficienteError", async () => {
    bruta.stockPorSucursal = {};
    await expect(crear()).rejects.toBeInstanceOf(StockInsuficienteError);
    expect(valoresPedido).toHaveLength(0);
  });

  it("reintento idempotente: devuelve el pedido existente sin bloquear ni asignar", async () => {
    existente = [{ id: "ped-0", numero: 999, cuotas: null }];
    const r = await crear({
      idempotencyKey: "0b1b0b1b-0b1b-4b1b-8b1b-0b1b0b1b0b1b",
    });
    expect(r).toMatchObject({ id: "ped-0", repetido: true });
    expect(eventos).toEqual([]);
    expect(leerBruta).not.toHaveBeenCalled();
  });

  it("una sucursal de reglas frescas: cambiar la zona entre pedidos cambia el origen sin caché", async () => {
    await crear();
    datos = {
      ...datos,
      zonas: [
        {
          id: "z1",
          provinciaClave: "misiones",
          sucursal: "sede-b",
          facturaSucursal: null,
        },
      ],
    };
    await crear();
    expect(valoresPedido.map((p) => p.sucursal)).toEqual(["sede-a", "sede-b"]);
  });
});

describe("crearPedido con el flag apagado", () => {
  it("valida contra la vista 0012 después del insert y, con sucursal, congela su reserva (no NULL)", async () => {
    const antes = Date.now();
    await crear({ disponibilidadSucursal: false });
    expect(leerBruta).not.toHaveBeenCalled();
    expect(disponiblesLegacy).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual(["pedido", "lock", "items"]);
    expect(valoresPedido[0]).toMatchObject({ sucursal: "sede-a" });
    const vence = (valoresPedido[0].reservaVenceEn as Date).getTime();
    expect(vence - antes).toBeGreaterThanOrEqual(7 * 24 * 60 * 60_000 - 5);
    expect(vence - antes).toBeLessThan(7 * 24 * 60 * 60_000 + 5_000);
    expect(valoresItems[0][0]).toMatchObject({ aTraerDe: null });
  });

  it("con reserva_dias 0 queda 'infinity'", async () => {
    reglas.reservaDias = 0;
    await crear({ disponibilidadSucursal: false });
    expect(sqlTexto(valoresPedido[0].reservaVenceEn)).toContain("infinity");
  });

  it("sin poder leer las reglas rige el default de 7 días", async () => {
    leerReglas.mockRejectedValueOnce(new Error("sin permiso"));
    const antes = Date.now();
    await crear({ disponibilidadSucursal: false });
    const vence = (valoresPedido[0].reservaVenceEn as Date).getTime();
    expect(vence - antes).toBeGreaterThanOrEqual(7 * 24 * 60 * 60_000 - 5);
    expect(vence - antes).toBeLessThan(7 * 24 * 60 * 60_000 + 5_000);
  });

  it("pago online conserva su ventana de 24 h", async () => {
    const antes = Date.now();
    await crear({ disponibilidadSucursal: false, pagoMetodo: "mercadopago" });
    const vence = (valoresPedido[0].reservaVenceEn as Date).getTime();
    expect(vence - antes).toBeLessThan(VENTANA_PAGO_MS + 5_000);
    expect(vence - antes).toBeGreaterThanOrEqual(VENTANA_PAGO_MS - 5);
  });

  it("sin contexto de sucursal (sin sucursalEntrada) no hay sucursal pero la reserva se congela igual", async () => {
    const antes = Date.now();
    await crear({ disponibilidadSucursal: false, sucursalEntrada: undefined });
    expect(valoresPedido[0].sucursal).toBeNull();
    const vence = (valoresPedido[0].reservaVenceEn as Date).getTime();
    expect(vence - antes).toBeGreaterThanOrEqual(7 * 24 * 60 * 60_000 - 5);
    expect(vence - antes).toBeLessThan(7 * 24 * 60 * 60_000 + 5_000);
  });

  it("sin sucursal y con reserva_dias 0 queda 'infinity'; con Mercado Pago, 24 h", async () => {
    reglas.reservaDias = 0;
    await crear({ disponibilidadSucursal: false, sucursalEntrada: undefined });
    expect(sqlTexto(valoresPedido[0].reservaVenceEn)).toContain("infinity");
    const antes = Date.now();
    await crear({ disponibilidadSucursal: false, sucursalEntrada: undefined, pagoMetodo: "mercadopago" });
    const vence = (valoresPedido.at(-1)!.reservaVenceEn as Date).getTime();
    expect(vence - antes).toBeGreaterThanOrEqual(VENTANA_PAGO_MS - 5);
    expect(vence - antes).toBeLessThan(VENTANA_PAGO_MS + 5_000);
  });

  it("sin sucursal y sin poder leer las reglas rige el default de 7 días", async () => {
    leerReglas.mockRejectedValueOnce(new Error("sin permiso"));
    const antes = Date.now();
    await crear({ disponibilidadSucursal: undefined, sucursalEntrada: undefined });
    const vence = (valoresPedido[0].reservaVenceEn as Date).getTime();
    expect(vence - antes).toBeGreaterThanOrEqual(7 * 24 * 60 * 60_000 - 5);
  });
});

describe("calcularReservaVenceEn", () => {
  const ahora = new Date("2026-01-10T12:00:00Z");
  it("sin cobro online: los días de las reglas", () => {
    expect(
      calcularReservaVenceEn("a_coordinar", { reservaDias: 3 }, ahora),
    ).toEqual(new Date("2026-01-13T12:00:00Z"));
  });
  it("0 días: nunca vence ('infinity')", () => {
    expect(
      calcularReservaVenceEn("efectivo", { reservaDias: 0 }, ahora),
    ).toBe("infinity");
  });
  it("sin reglas: 7 días", () => {
    expect(calcularReservaVenceEn("efectivo", null, ahora)).toEqual(
      new Date("2026-01-17T12:00:00Z"),
    );
  });
  it("Mercado Pago: 24 h, sin mirar las reglas", () => {
    expect(
      calcularReservaVenceEn("mercadopago", { reservaDias: 0 }, ahora),
    ).toEqual(new Date("2026-01-11T12:00:00Z"));
  });
});

/**
 * Venta sin stock por modalidad: la línea "a pedido" (la cotización le dejó `ventaSinStock`) pasa las
 * compuertas de stock y sale de la sucursal del pedido; la modalidad se relee fresca en la transacción
 * y se congela en `order_items.venta_sin_stock`. Las demás líneas, exactamente como antes.
 */
describe("crearPedido con líneas a pedido", () => {
  it("flag on: la línea a pedido no dispara SucursalPedidoError y sale de la sucursal del pedido", async () => {
    bruta.stockPorSucursal = { "1": { "sede-a": 0, "sede-b": 0 } };
    await crear({}, cotizacion(lineaAPedido("1")));
    expect(valoresPedido[0]).toMatchObject({ sucursal: "sede-a" });
    expect(valoresItems[0][0]).toMatchObject({ alegraItemId: "1", aTraerDe: null });
  });

  it("flag on: retiro, la línea a pedido sale del local elegido aunque la otra sucursal no tenga", async () => {
    reglas.retiroSinStock = "bloquear";
    bruta.stockPorSucursal = { "1": { "sede-a": 0, "sede-b": 0 } };
    await crear(
      { entregaTipo: "retiro", sucursalEntrada: { entregaTipo: "retiro", sucursalRetiro: "sede-b" } },
      cotizacion(lineaAPedido("1")),
    );
    expect(valoresPedido[0]).toMatchObject({ sucursal: "sede-b" });
    expect(valoresItems[0][0]).toMatchObject({ aTraerDe: null });
  });

  it("flag on: una normal sin stock junto a una a pedido sigue tirando sin_stock sólo con la normal", async () => {
    bruta.stockPorSucursal = { "1": { "sede-a": 0, "sede-b": 0 }, "2": { "sede-a": 0, "sede-b": 0 } };
    const err = await crear({}, cotizacion(lineaAPedido("1"), linea("2"))).catch((e) => e);
    expect(err).toBeInstanceOf(SucursalPedidoError);
    expect(err).toMatchObject({ codigo: "sin_stock", ids: ["2"] });
    expect(valoresPedido).toHaveLength(0);
  });

  it("flag on: un id fuera del espejo sigue siendo error aunque venga a pedido", async () => {
    bruta.stockPorSucursal = {};
    await expect(crear({}, cotizacion(lineaAPedido("1")))).rejects.toBeInstanceOf(StockInsuficienteError);
  });

  it("flag off: disponiblesEnTx no cuenta como faltante la línea a pedido; la normal sin stock sigue tirando", async () => {
    const sinStock = () =>
      new Map<string, number | null>([
        ["1", 0],
        ["2", 0],
      ]);
    disponiblesLegacy.mockResolvedValueOnce(sinStock()).mockResolvedValueOnce(sinStock());
    await crear({ disponibilidadSucursal: false }, cotizacion(lineaAPedido("1")));
    expect(valoresItems[0][0]).toMatchObject({ alegraItemId: "1" });

    const err = await crear({ disponibilidadSucursal: false }, cotizacion(lineaAPedido("1"), linea("2"))).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(StockInsuficienteError);
    expect(err.ids).toEqual(["2"]);
  });

  it("flag off: un id fuera del espejo sigue siendo error aunque venga a pedido", async () => {
    disponiblesLegacy.mockResolvedValueOnce(new Map<string, number | null>());
    const err = await crear({ disponibilidadSucursal: false }, cotizacion(lineaAPedido("1"))).catch((e) => e);
    expect(err).toBeInstanceOf(StockInsuficienteError);
    expect(err.ids).toEqual(["1"]);
  });

  it("inserta el snapshot en venta_sin_stock y null en las líneas normales", async () => {
    bruta.stockPorSucursal = { "1": { "sede-a": 0, "sede-b": 0 }, "2": { "sede-a": 5, "sede-b": 5 } };
    await crear({}, cotizacion(lineaAPedido("1", MODALIDAD_A_CONFIRMAR), linea("2")));
    // Lectura fresca dentro de la transacción (savepoint: el ejecutor anidado es el mismo mock).
    expect(leerModalidades).toHaveBeenCalledWith(tx);
    const items = valoresItems[0];
    expect(items.find((i) => i.alegraItemId === "1")?.ventaSinStock).toEqual({
      modalidadId: "mod-pedido",
      nombre: "A pedido interno",
      texto: "A pedido",
      plazoDias: null,
      flujo: "a_confirmar",
    });
    expect(items.find((i) => i.alegraItemId === "2")?.ventaSinStock).toBeNull();
  });

  it("el snapshot toma la modalidad fresca (texto y plazo de ahora, mismo flujo)", async () => {
    modalidades = [{ ...MODALIDAD_EN_LINEA, texto: "Retiro en ~72 h", plazoDias: 3 }];
    bruta.stockPorSucursal = { "1": { "sede-a": 0, "sede-b": 0 } };
    await crear({}, cotizacion(lineaAPedido("1")));
    expect(valoresItems[0][0].ventaSinStock).toMatchObject({ texto: "Retiro en ~72 h", plazoDias: 3 });
  });

  it("sin líneas a pedido no lee las modalidades y todas las líneas van con null", async () => {
    await crear();
    await crear({ disponibilidadSucursal: false });
    expect(leerModalidades).not.toHaveBeenCalled();
    expect(valoresItems.flat().every((i) => i.ventaSinStock === null)).toBe(true);
  });

  it("flujo distinto al cotizado → VentaSinStockCambioError y no se escriben líneas", async () => {
    modalidades = [{ ...MODALIDAD_EN_LINEA, flujo: "a_confirmar" }];
    bruta.stockPorSucursal = { "1": { "sede-a": 0, "sede-b": 0 } };
    const err = await crear({}, cotizacion(lineaAPedido("1"))).catch((e) => e);
    expect(err).toBeInstanceOf(VentaSinStockCambioError);
    expect(err.ids).toEqual(["1"]);
    expect(valoresItems).toHaveLength(0);
  });

  it("modalidad desactivada (o ilegible) entre la cotización y la transacción → VentaSinStockCambioError", async () => {
    modalidades = [];
    disponiblesLegacy.mockResolvedValueOnce(
      new Map<string, number | null>([
        ["1", 0],
        ["2", null],
      ]),
    );
    const err = await crear({ disponibilidadSucursal: false }, cotizacion(lineaAPedido("1"), linea("2"))).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(VentaSinStockCambioError);
    expect(err.ids).toEqual(["1"]);
    expect(valoresItems).toHaveLength(0);
  });
});
