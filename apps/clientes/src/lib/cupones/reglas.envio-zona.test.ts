import { describe, expect, it } from "vitest";
import type { Cotizacion, LineaCotizada } from "../cotizacion";
import { aplicarCupon } from "./reglas";
import { aplicadorDeCupon } from "./aplicar";
import type { ContextoCupon, PromocionCupon } from "./tipos";

/**
 * Cupones con envío por zona (change `envio-por-zona-con-tarifa`, D10): el descuento se calcula SIN el
 * envío, el envío gratis del cupón sólo anula la tarifa si el método lo admite (`envioGratisAplica`) y
 * el mínimo mira el total sin envío.
 */

function linea(precioUnitario: number, qty: number): LineaCotizada {
  const subtotal = Math.round(precioUnitario * qty * 100) / 100;
  const iva = Math.round(subtotal * 21) / 100;
  return {
    id: "a", code: null, name: "a", brand: "", qty, precioUnitario, ivaPorcentaje: 21,
    subtotal, iva, total: Math.round((subtotal + iva) * 100) / 100, stockDisponible: 10,
  };
}

/** 2 x 1000 + IVA = 2420 y un envío de 3000. */
function cotConEnvio(costoEnvio = 3000): Cotizacion {
  const l = linea(1000, 2);
  return {
    lineas: [l], subtotal: l.subtotal, iva: l.iva, costoEnvio, total: l.subtotal + l.iva + costoEnvio,
    hayProblemas: false, listaPrivada: false, flujo: "normal",
  } as Cotizacion;
}

const promo = (o: Partial<PromocionCupon> = {}): PromocionCupon => ({
  codigoId: "c1", codigo: "LUZ-7KQ2M", promocionId: "p1", nombre: "Bot", tipo: "unicos",
  pct: 10, envioGratis: false, provinciasEnvio: null,
  inicio: "2026-11-01T00:00:00-03:00", fin: "2026-12-01T00:00:00-03:00", venceEn: null,
  soloPrimeraCompra: false, minimo: null, medios: null, formas: null, permiteCuotas: false, limiteCanjes: null,
  condiciones: "", activa: true, ...o,
});

const ctx: ContextoCupon = {
  ahora: new Date("2026-11-05T12:00:00-03:00"),
  opcion: { slug: "transferencia", forma: null, cuotasSinInteres: false },
  entrega: { tipo: "envio", provincia: "Buenos Aires" },
  totalListaGeneral: 99999, motivoCuenta: null, verificado: true, congelado: false,
};

describe("aplicarCupon con costo de envío", () => {
  it("el % descuenta sólo las líneas: el envío queda igual y no entra en el descuento", () => {
    const r = aplicarCupon(cotConEnvio(), promo({ pct: 10 }), ctx);
    // 2420 -> 2178 en líneas; descuento = 242 (nada del envío).
    expect(r.costoEnvio).toBe(3000);
    expect(r.total).toBe(2178 + 3000);
    expect(r.cupon?.descuento).toBe(242);
  });

  it("sin costo de envío (flag apagado) el resultado es el de siempre", () => {
    const r = aplicarCupon(cotConEnvio(0), promo({ pct: 10 }), ctx);
    expect(r.total).toBe(2178);
    expect(r.cupon?.descuento).toBe(242);
  });

  it("cupón de envío gratis: anula la tarifa y el descuento NO la cuenta", () => {
    const r = aplicarCupon(cotConEnvio(), promo({ pct: 10, envioGratis: true }), ctx);
    expect(r.costoEnvio).toBe(0);
    expect(r.total).toBe(2178);
    expect(r.cupon).toMatchObject({ envioGratis: true, descuento: 242 });
  });

  it("cupón de sólo envío gratis y método que lo admite: total sin envío y descuento 0", () => {
    const r = aplicarCupon(cotConEnvio(), promo({ pct: null, envioGratis: true }), ctx);
    expect(r.costoEnvio).toBe(0);
    expect(r.total).toBe(2420);
    expect(r.cupon).toMatchObject({ envioGratis: true, descuento: 0 });
  });

  it("método que no admite envío gratis (envioGratisAplica=false): el cupón NO anula la tarifa", () => {
    const r = aplicarCupon(cotConEnvio(), promo({ pct: 10, envioGratis: true }), { ...ctx, envioGratisAplica: false });
    expect(r.costoEnvio).toBe(3000);
    expect(r.total).toBe(2178 + 3000);
    expect(r.cupon).toMatchObject({ pctAplicado: true, envioGratis: false, descuento: 242 });
  });

  it("método que no admite envío gratis y cupón sólo de envío: no aplica", () => {
    const r = aplicarCupon(cotConEnvio(), promo({ pct: null, envioGratis: true }), { ...ctx, envioGratisAplica: false });
    expect(r.cuponError?.motivo).toBe("solo_envio");
    expect(r.cupon).toBeNull();
    expect(r.total).toBe(cotConEnvio().total);
  });

  it("envioGratisAplica ausente equivale a true (sin método, como siempre)", () => {
    const r = aplicarCupon(cotConEnvio(0), promo({ pct: null, envioGratis: true }), ctx);
    expect(r.cupon?.envioGratis).toBe(true);
  });
});

describe("aplicadorDeCupon: mínimo y envioGratisAplica", () => {
  it("pasa envioGratisAplica al contexto", async () => {
    const aplicar = aplicadorDeCupon({
      cupon: { promo: promo({ pct: null, envioGratis: true }), motivoCuenta: null, verificado: true },
      entrega: ctx.entrega,
      totalListaGeneral: async () => 0,
      envioGratisAplica: false,
    });
    const r = await aplicar(cotConEnvio(), ctx.opcion);
    expect(r.cuponError?.motivo).toBe("solo_envio");
  });
});
