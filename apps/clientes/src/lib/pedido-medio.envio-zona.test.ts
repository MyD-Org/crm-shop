import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedioPago } from "./medios-pago";

/**
 * `cotizarConMedio` con el costo de envío por zona (change `envio-por-zona-con-tarifa`): UN solo
 * `costoEnvioPara` llega a TODAS las cotizaciones (la del medio, la base de cuotas, el mínimo del
 * cupón), el mínimo del cupón mira el total SIN envío y el cupón de envío gratis respeta
 * `envioGratisAplica`.
 */

const cotizar = vi.fn();
vi.mock("./cotizacion", async (orig) => ({
  ...(await orig<typeof import("./cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("./cuotas-flag", () => ({ cuotasHabilitadas: async () => true }));

import { cotizarConMedio } from "./pedido-medio";

const MP: MedioPago = {
  slug: "mercadopago",
  nombre: "Mercado Pago",
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: true,
  orden: 1,
  idListaPrecios: "A",
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  condicionesCuotas: [{ cuotas: 3, idListaPrecios: "C", montoMinimo: 1500, marcas: null }],
};

const PRECIOS: Record<string, number> = { A: 1000, B: 900, C: 1100 };
const linea = (pu: number) => ({
  id: "1", code: null, name: "x", brand: "", qty: 1, precioUnitario: pu, ivaPorcentaje: 0, subtotal: pu, iva: 0, total: pu, stockDisponible: 5,
});

const promo = (o: Record<string, unknown> = {}) => ({
  codigoId: "c1", codigo: "LUZ-7KQ2M", promocionId: "p1", nombre: "Bot", tipo: "unicos" as const, pct: 10, envioGratis: false,
  provinciasEnvio: null, inicio: "2026-01-01T00:00:00-03:00", fin: "2099-01-01T00:00:00-03:00", venceEn: null,
  soloPrimeraCompra: false, minimo: null, medios: null, formas: null, permiteCuotas: false, limiteCanjes: null, condiciones: "", activa: true, ...o,
});
const cupon = (o: Record<string, unknown> = {}) => ({ promo: promo(o) as never, motivoCuenta: null, verificado: true });

const llamar = (extra: Partial<Parameters<typeof cotizarConMedio>[0]> = {}) =>
  cotizarConMedio({
    lineas: [{ id: "1", qty: 1 }],
    entregaTipo: "envio",
    pagoMetodo: "mercadopago",
    cuotasPedidas: undefined,
    mediosCrm: [MP],
    opcionesMedios: {},
    idListaPrivada: null,
    soloVisibles: false,
    ...extra,
  });

beforeEach(() => {
  cotizar.mockReset();
  // Imita a `cotizar` real: el costo sale de `costoEnvioPara(subtotal)`.
  cotizar.mockImplementation(async (_l: unknown, o: { idListaMedio?: string; costoEnvioPara?: (s: number) => number }) => {
    const pu = PRECIOS[o.idListaMedio ?? ""] ?? 1200;
    const costoEnvio = o.costoEnvioPara ? o.costoEnvioPara(pu) : 0;
    return { lineas: [linea(pu)], subtotal: pu, iva: 0, costoEnvio, total: pu + costoEnvio, hayProblemas: false, listaPrivada: false, flujo: "normal" };
  });
});

describe("cotizarConMedio: costo de envío", () => {
  it("sin costoEnvioPara no cambia nada (flag apagado)", async () => {
    const r = await llamar();
    expect(r.ok && r.cotizacion).toMatchObject({ costoEnvio: 0, total: 1000 });
    expect(cotizar.mock.calls.every(([, o]) => !("costoEnvioPara" in (o as object)))).toBe(true);
  });

  it("el costo llega a la cotización, al total y a opcionesCotizar (para las recotizaciones)", async () => {
    const costoEnvioPara = () => 3000;
    const r = await llamar({ costoEnvioPara });
    expect(r.ok && r.cotizacion).toMatchObject({ costoEnvio: 3000, total: 4000 });
    expect(r.ok && r.opcionesCotizar.costoEnvioPara).toBe(costoEnvioPara);
  });

  it("la base del mínimo de cuotas (otra cotización) hereda el mismo costo", async () => {
    await llamar({ costoEnvioPara: () => 3000, cuotasPedidas: 3 });
    const conLista = cotizar.mock.calls.map(([, o]) => o as { costoEnvioPara?: unknown });
    expect(conLista.length).toBeGreaterThan(1);
    expect(conLista.every((o) => typeof o.costoEnvioPara === "function")).toBe(true);
  });

  it("cuotas: la base del mínimo incluye el envío (la barra y la oferta la miran con envío)", async () => {
    // Base = pago único (1000) + envío 3000 = 4000 >= 1500: se ofrecen las 3 cuotas.
    const r = await llamar({ costoEnvioPara: () => 3000, cuotasPedidas: 3 });
    expect(r.ok && r.cuotasPedido).toBe(3);
  });

  it("el % del cupón no toca el envío", async () => {
    const r = await llamar({ costoEnvioPara: () => 3000, cupon: cupon(), pagoMetodo: "mercadopago" });
    expect(r.ok && r.cotizacion).toMatchObject({ costoEnvio: 3000, total: 900 + 3000 });
    expect(r.ok && r.cotizacion.cupon?.descuento).toBe(100);
  });

  it("el mínimo del cupón se mide SIN el envío", async () => {
    // Total lista general = 1200 (sin lista) + 3000 de envío: con envío pasaría el mínimo 2000, sin envío no.
    const r = await llamar({ costoEnvioPara: () => 3000, cupon: cupon({ minimo: 2000 }) });
    expect(r.ok && r.cotizacion.cuponError?.motivo).toBe("minimo");
    const ok = await llamar({ costoEnvioPara: () => 3000, cupon: cupon({ minimo: 1200 }) });
    expect(ok.ok && ok.cotizacion.cupon).toBeTruthy();
  });

  it("cupón de envío gratis: anula la tarifa sólo si el método lo admite", async () => {
    const admite = await llamar({ costoEnvioPara: () => 3000, cupon: cupon({ pct: null, envioGratis: true }) });
    expect(admite.ok && admite.cotizacion).toMatchObject({ costoEnvio: 0, total: 1000 });
    const noAdmite = await llamar({
      costoEnvioPara: () => 3000,
      envioGratisAplica: false,
      cupon: cupon({ pct: null, envioGratis: true }),
    });
    expect(noAdmite.ok && noAdmite.cotizacion.cuponError?.motivo).toBe("solo_envio");
    expect(noAdmite.ok && noAdmite.cotizacion.costoEnvio).toBe(3000);
  });
});
