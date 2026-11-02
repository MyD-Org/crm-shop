import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cotizacion } from "@/lib/cotizacion";
import type { MedioPago } from "@/lib/medios-pago";
import type { CuponPedido, PromocionCupon } from "@/lib/cupones/tipos";

/**
 * Cupón en `/api/carrito/cotizar` (spec 2026-11-01-cupones-design.md): el total de cada card y de cada
 * cantidad de cuotas con el cupón si esa opción es elegible; el envío gratis de la tienda sobre el
 * subtotal ANTES del cupón; un cupón ilegible no cobra de más sin avisar; el cambio de medio toma el
 * cupón del pedido (del dueño). `cotizar` y el repo de cupones se simulan; las reglas son las reales.
 */

/** Precio neto por lista: así cada opción tiene su total. */
const PRECIO: Record<string, number> = { T: 900, M: 1000, L3: 1100, L6: 1200, GEN: 1000 };
const cotizar = vi.fn(async (_l: unknown, o: { idListaMedio?: string }): Promise<Cotizacion> => {
  const pu = PRECIO[o.idListaMedio ?? "GEN"] ?? 1000;
  const subtotal = pu * qty;
  const iva = Math.round(subtotal * 21) / 100;
  return {
    lineas: [{ id: "1", code: null, name: "Lámpara", brand: "", qty, precioUnitario: pu, ivaPorcentaje: 21, subtotal, iva, total: subtotal + iva, stockDisponible: 50 }],
    subtotal, iva, costoEnvio: 0, total: subtotal + iva, hayProblemas: false, listaPrivada: false, flujo: "normal",
  };
});
const resolverCupon = vi.fn();
const cuponDelPedido = vi.fn();
let qty = 1;
let medios: MedioPago[];
let configEnvio: unknown;

vi.mock("@/lib/auth", () => ({ identidadActual: async () => ({ clerkUserId: "user_ana", email: "ana@cliente.example", cliente: null }) }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: async () => null }));
vi.mock("@/lib/cotizacion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: [unknown, { idListaMedio?: string }]) => cotizar(...a),
}));
vi.mock("@/lib/sucursales-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => configEnvio,
}));
vi.mock("@/lib/pagos", () => ({ procesadorConfigurado: () => true }));
let cuponesPermitidos = true;
const clavesLimite: string[] = [];
vi.mock("@/lib/rate-limit", () => ({
  permitirAsync: async (clave: string) => {
    clavesLimite.push(clave);
    return clave.startsWith("cupon:") ? cuponesPermitidos : true;
  },
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: async () => true }));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios }));
vi.mock("@/lib/cupones/repo", () => ({
  resolverCupon: (...a: unknown[]) => resolverCupon(...a),
  cuponDelPedido: (...a: unknown[]) => cuponDelPedido(...a),
}));

import { POST } from "./route";

const medio = (o: Partial<MedioPago>): MedioPago => ({
  slug: "transferencia", nombre: "Transferencia", instrucciones: "", activo: true, aplicaRetiro: true, aplicaEnvio: true,
  cobroOnline: false, orden: 1, idListaPrecios: "T", destacarEnCatalogo: false, mostrarEnFicha: false, ...o,
});
const MP = medio({
  slug: "mercadopago", nombre: "Mercado Pago", cobroOnline: true, orden: 2, idListaPrecios: "M",
  condicionesCuotas: [{ cuotas: 3, idListaPrecios: "L3" }, { cuotas: 6, idListaPrecios: "L6" }],
});

const promo = (o: Partial<PromocionCupon> = {}): PromocionCupon => ({
  codigoId: "c1", codigo: "LUZ-7KQ2M", promocionId: "p1", nombre: "Bot Instagram", tipo: "unicos", pct: 10,
  envioGratis: false, provinciasEnvio: null, inicio: "2026-01-01T00:00:00-03:00", fin: "2099-01-01T00:00:00-03:00",
  venceEn: null, soloPrimeraCompra: true, minimo: null, medios: null, formas: null, permiteCuotas: false,
  limiteCanjes: null, condiciones: "", activa: true, ...o,
});
const valido = (p: PromocionCupon) => ({ ok: true, promo: p, motivoCuenta: null, verificado: true });

let n = 0;
const pedir = async (extra: Record<string, unknown> = {}) => {
  const res = await POST(
    new Request("https://tienda.example/api/carrito/cotizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `192.0.2.${(n = (n % 200) + 1)}` },
      body: JSON.stringify({ items: [{ id: "1", qty }], ...extra }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

beforeEach(() => {
  cuponesPermitidos = true;
  clavesLimite.length = 0;
  qty = 1;
  medios = [medio({}), MP];
  configEnvio = { domicilioActivo: true, gratis: null };
  cotizar.mockClear();
  resolverCupon.mockReset();
  cuponDelPedido.mockReset();
  resolverCupon.mockResolvedValue(valido(promo()));
});

describe("POST /api/carrito/cotizar con cupón", () => {
  it("cupón válido: la cotización trae el cupón y el total con descuento", async () => {
    const r = await pedir({ pagoMetodo: "transferencia", cupon: "luz 7kq2m" });
    expect(resolverCupon).toHaveBeenCalledWith("luz 7kq2m", { clerkUserId: "user_ana", email: "ana@cliente.example", listaPrivada: false });
    expect(r.cupon).toMatchObject({ codigo: "LUZ-7KQ2M", pctAplicado: true });
    expect(r.total).toBeCloseTo(810 * 1.21, 2);
    expect(r.lineas[0]).toMatchObject({ precioUnitario: 810, precioSinCupon: 900 });
  });

  it("sin cupón no consulta el repo", async () => {
    await pedir({ pagoMetodo: "transferencia" });
    expect(resolverCupon).not.toHaveBeenCalled();
  });

  it("cada card con su total: con cupón la elegible, sin cupón la otra, y cuponPorOpcion", async () => {
    resolverCupon.mockResolvedValue(valido(promo({ medios: ["transferencia"] })));
    const r = await pedir({ pagoMetodo: "transferencia", cupon: "LUZ-7KQ2M", totalesOpciones: true });
    expect(r.totalesOpciones.transferencia).toBeCloseTo(810 * 1.21, 2);
    expect(r.totalesOpciones["mercadopago:credito"]).toBeCloseTo(1000 * 1.21, 2);
    expect(r.cuponPorOpcion).toMatchObject({ transferencia: true, "mercadopago:credito": false, "mercadopago:debito": false });
  });

  it("opción no elegible elegida: total sin cupón y aviso no bloqueante", async () => {
    resolverCupon.mockResolvedValue(valido(promo({ medios: ["transferencia"] })));
    const r = await pedir({ pagoMetodo: "mercadopago", forma: "credito", cupon: "LUZ-7KQ2M" });
    expect(r.cupon).toBeNull();
    expect(r.cuponError).toEqual({ motivo: "opcion_no_elegible", mensaje: "Su cupón es válido sólo pagando con Transferencia." });
    expect(r.total).toBeCloseTo(1000 * 1.21, 2);
  });

  it("cuotas sólo en 1 pago: la cantidad 1 con cupón, 3 y 6 sin cupón", async () => {
    const r = await pedir({ pagoMetodo: "mercadopago", forma: "credito", cupon: "LUZ-7KQ2M", conCuotas: true });
    const porN = Object.fromEntries((r.cuotasOpciones as { cuotas: number; total: number }[]).map((o) => [o.cuotas, o.total]));
    expect(porN[1]).toBeCloseTo(900 * 1.21, 2);
    expect(porN[3]).toBeCloseTo(1100 * 1.21, 2);
    expect(porN[6]).toBeCloseTo(1200 * 1.21, 2);
  });

  it("cuotas sin interés con permiteCuotas: el cupón también en 3 y 6", async () => {
    resolverCupon.mockResolvedValue(valido(promo({ permiteCuotas: true })));
    const r = await pedir({ pagoMetodo: "mercadopago", forma: "credito", cupon: "LUZ-7KQ2M", conCuotas: true });
    const porN = Object.fromEntries((r.cuotasOpciones as { cuotas: number; total: number }[]).map((o) => [o.cuotas, o.total]));
    expect(porN[3]).toBeCloseTo(990 * 1.21, 2);
  });

  it("mínimo: una cotización extra a la lista general sólo si la promoción tiene mínimo", async () => {
    await pedir({ pagoMetodo: "transferencia", cupon: "LUZ-7KQ2M" });
    const sinMinimo = cotizar.mock.calls.length;
    cotizar.mockClear();
    resolverCupon.mockResolvedValue(valido(promo({ minimo: 1000 })));
    const r = await pedir({ pagoMetodo: "transferencia", cupon: "LUZ-7KQ2M" });
    expect(cotizar.mock.calls.length).toBe(sinMinimo + 1);
    expect(cotizar.mock.calls.some(([, o]) => o.idListaMedio === undefined)).toBe(true);
    expect(r.cupon).toBeTruthy();
    resolverCupon.mockResolvedValue(valido(promo({ minimo: 1300 })));
    expect((await pedir({ pagoMetodo: "transferencia", cupon: "LUZ-7KQ2M" })).cuponError?.motivo).toBe("minimo");
  });

  it("envío gratis de la tienda sobre el subtotal ANTES del cupón", async () => {
    configEnvio = { domicilioActivo: true, gratis: { alcance: "pais", provincias: [], minimo: 10000 } };
    PRECIO.T = 10500;
    try {
      const r = await pedir({ pagoMetodo: "transferencia", entregaTipo: "envio", provincia: "Córdoba", cupon: "LUZ-7KQ2M" });
      expect(r.subtotal).toBe(9450);
      expect(r.envio.gratis).toBe(true);
    } finally {
      PRECIO.T = 900;
    }
  });

  it("envío gratis del cupón: el envío sale gratis aunque la tienda no lo tenga", async () => {
    resolverCupon.mockResolvedValue(valido(promo({ pct: null, envioGratis: true })));
    const r = await pedir({ pagoMetodo: "transferencia", entregaTipo: "envio", provincia: "Buenos Aires", cupon: "LUZ-7KQ2M" });
    expect(r.cupon).toMatchObject({ envioGratis: true, descuento: 0 });
    expect(r.envio).toMatchObject({ gratis: true, aCoordinar: false });
  });

  it("cupón ilegible: 200 con no_disponible y total sin cupón", async () => {
    resolverCupon.mockResolvedValue({ ok: false, error: { motivo: "no_disponible", mensaje: "No pudimos validar el cupón. Inténtelo de nuevo en un momento." } });
    const r = await pedir({ pagoMetodo: "transferencia", cupon: "LUZ-7KQ2M", totalesOpciones: true });
    expect(r.cuponError.motivo).toBe("no_disponible");
    expect(r.cupon ?? null).toBeNull();
    expect(r.total).toBeCloseTo(900 * 1.21, 2);
    expect(r.cuponPorOpcion).toBeUndefined();
  });

  it("límite propio de consultas de cupón (frena probar códigos): superado, no_disponible sin leer la base", async () => {
    cuponesPermitidos = false;
    const r = await pedir({ pagoMetodo: "transferencia", cupon: "LUZ-7KQ2M" });
    expect(resolverCupon).not.toHaveBeenCalled();
    expect(r.cuponError.motivo).toBe("no_disponible");
    expect(clavesLimite).toContain("cupon:user_ana");
  });

  it("carrito sin medio: aplica y avisa la restricción", async () => {
    resolverCupon.mockResolvedValue(valido(promo({ medios: ["transferencia"] })));
    const r = await pedir({ cupon: "LUZ-7KQ2M" });
    expect(r.cupon).toMatchObject({ pctAplicado: true, aviso: "Su cupón es válido sólo pagando con Transferencia." });
  });

  it("cambio de medio (pedidoId): toma el cupón del pedido del dueño e ignora el del body", async () => {
    const foto: CuponPedido = {
      codigoId: "c1", codigo: "LUZ-7KQ2M", promocionId: "p1", nombre: "Bot Instagram", pct: 10, envioGratis: false,
      provinciasEnvio: null, medios: ["transferencia"], formas: null, permiteCuotas: false, condiciones: "", descuento: 196.02,
    };
    cuponDelPedido.mockImplementation(async (id: string, usuario: string) => (id === "ped-1" && usuario === "user_ana" ? foto : null));
    const r = await pedir({ pagoMetodo: "mercadopago", forma: "credito", pedidoId: "ped-1", cupon: "OTRO1234" });
    expect(resolverCupon).not.toHaveBeenCalled();
    expect(r.cuponError?.motivo).toBe("opcion_no_elegible");
    const r2 = await pedir({ pagoMetodo: "transferencia", pedidoId: "ped-1" });
    expect(r2.cupon).toMatchObject({ codigo: "LUZ-7KQ2M", pctAplicado: true });
  });

  it("pedidoId de otro dueño: no se aplica nada", async () => {
    cuponDelPedido.mockResolvedValue(null);
    const r = await pedir({ pagoMetodo: "transferencia", pedidoId: "ped-ajeno", cupon: "LUZ-7KQ2M" });
    expect(resolverCupon).not.toHaveBeenCalled();
    expect(r.cupon ?? null).toBeNull();
    expect(r.total).toBeCloseTo(900 * 1.21, 2);
  });
});
