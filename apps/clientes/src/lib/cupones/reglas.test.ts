import { describe, expect, it } from "vitest";
import type { Cotizacion, LineaCotizada } from "../cotizacion";
import { aplicarCupon, cuponPedidoDesde, motivoVigencia, normalizarCodigo, opcionElegible, promoDesdePedido } from "./reglas";
import type { ContextoCupon, PromocionCupon } from "./tipos";

function linea(l: { id: string; precioUnitario: number; qty: number; ivaPorcentaje: number; campaniaId?: string; problema?: LineaCotizada["problema"] }): LineaCotizada {
  const subtotal = Math.round(l.precioUnitario * l.qty * 100) / 100;
  const iva = Math.round(subtotal * l.ivaPorcentaje) / 100;
  return {
    id: l.id, code: null, name: l.id, brand: "", qty: l.qty, precioUnitario: l.precioUnitario, ivaPorcentaje: l.ivaPorcentaje,
    subtotal, iva, total: Math.round((subtotal + iva) * 100) / 100, stockDisponible: 10,
    ...(l.campaniaId ? { campaniaId: l.campaniaId, precioNormal: l.precioUnitario * 2 } : {}),
    ...(l.problema ? { problema: l.problema } : {}),
  };
}

function cotizacionDe(ls: Parameters<typeof linea>[0][]): Cotizacion {
  const lineas = ls.map(linea);
  const validas = lineas.filter((l) => !l.problema);
  const subtotal = validas.reduce((a, l) => a + l.subtotal, 0);
  const iva = validas.reduce((a, l) => a + l.iva, 0);
  return { lineas, subtotal, iva, costoEnvio: 0, total: subtotal + iva, hayProblemas: lineas.some((l) => l.problema), listaPrivada: false, flujo: "normal" } as Cotizacion;
}

const promo = (o: Partial<PromocionCupon> = {}): PromocionCupon => ({
  codigoId: "c1", codigo: "LUZ-7KQ2M", promocionId: "p1", nombre: "Bot Instagram", tipo: "unicos",
  pct: 10, envioGratis: false, provinciasEnvio: null,
  inicio: "2026-11-01T00:00:00-03:00", fin: "2026-12-01T00:00:00-03:00", venceEn: null,
  soloPrimeraCompra: true, minimo: null, medios: null, formas: null, permiteCuotas: false, limiteCanjes: null,
  condiciones: "Sólo primera compra.", activa: true, ...o,
});

const cot = cotizacionDe([
  { id: "a", precioUnitario: 1000, qty: 2, ivaPorcentaje: 21 },
  { id: "b", precioUnitario: 500, qty: 1, ivaPorcentaje: 21, campaniaId: "c1" },
]);
const cotSoloCampania = cotizacionDe([{ id: "b", precioUnitario: 500, qty: 1, ivaPorcentaje: 21, campaniaId: "c1" }]);
const ctx: ContextoCupon = {
  ahora: new Date("2026-11-05T12:00:00-03:00"),
  opcion: { slug: "transferencia", forma: null, cuotasSinInteres: false },
  entrega: { tipo: "envio", provincia: "Buenos Aires" },
  totalListaGeneral: 99999, motivoCuenta: null, verificado: true, congelado: false,
};

describe("aplicarCupon", () => {
  it("aplica el % sólo a líneas sin campaña y guarda el unitario previo", () => {
    const r = aplicarCupon(cot, promo({ pct: 10 }), ctx);
    expect(r.lineas[0]).toMatchObject({ precioUnitario: 900, precioSinCupon: 1000, subtotal: 1800, iva: 378, total: 2178 });
    expect(r.lineas[1].precioUnitario).toBe(500);
    expect(r.lineas[1].precioSinCupon).toBeUndefined();
    expect(r.subtotal).toBe(2300);
    expect(r.total).toBe(2783);
    expect(r.cupon).toMatchObject({ codigo: "LUZ-7KQ2M", pctAplicado: true, envioGratis: false, descuento: 242, subtotalAntes: 2500, verificado: true, aviso: null });
    expect(r.cuponError).toBeNull();
  });

  it("no toca líneas con problema", () => {
    const c = cotizacionDe([{ id: "a", precioUnitario: 1000, qty: 1, ivaPorcentaje: 21 }, { id: "x", precioUnitario: 300, qty: 1, ivaPorcentaje: 21, problema: "sin_stock" }]);
    const r = aplicarCupon(c, promo(), ctx);
    expect(r.lineas[1].precioUnitario).toBe(300);
    expect(r.lineas[1].precioSinCupon).toBeUndefined();
  });

  it("todo en campaña + envío gratis: el cupón queda aplicado sólo con envío y aviso", () => {
    const r = aplicarCupon(cotSoloCampania, promo({ pct: 10, envioGratis: true }), ctx);
    expect(r.cupon).toMatchObject({ pctAplicado: false, envioGratis: true, descuento: 0, aviso: "El descuento no se suma a productos con precio promocional." });
    expect(r.total).toBe(cotSoloCampania.total);
  });

  it("todo en campaña y sólo %: rechaza con todo_en_campania", () => {
    const r = aplicarCupon(cotSoloCampania, promo({ pct: 10 }), ctx);
    expect(r.cuponError?.motivo).toBe("todo_en_campania");
    expect(r.cupon).toBeNull();
  });

  it("mínimo contra totalListaGeneral, no contra la lista del medio", () => {
    expect(aplicarCupon(cot, promo({ minimo: 5000 }), { ...ctx, totalListaGeneral: 4999 }).cuponError?.motivo).toBe("minimo");
    expect(aplicarCupon(cot, promo({ minimo: 5000 }), { ...ctx, totalListaGeneral: 5000 }).cupon).toBeTruthy();
  });

  it("opción no elegible: cotización sin descuento, error no bloqueante con el texto", () => {
    const r = aplicarCupon(cot, promo({ medios: ["transferencia"] }), { ...ctx, opcion: { slug: "mercadopago", forma: "credito", cuotasSinInteres: false } });
    expect(r.total).toBe(cot.total);
    expect(r.lineas[0].precioSinCupon).toBeUndefined();
    expect(r.cuponError).toEqual({ motivo: "opcion_no_elegible", mensaje: "Su cupón es válido sólo pagando con Transferencia." });
  });

  it("envío gratis sólo a domicilio y en provincias alcanzadas (claves)", () => {
    const p = promo({ pct: null, envioGratis: true, provinciasEnvio: ["buenosaires"] });
    expect(aplicarCupon(cot, p, { ...ctx, entrega: { tipo: "retiro", provincia: null } }).cuponError?.motivo).toBe("solo_envio");
    expect(aplicarCupon(cot, p, { ...ctx, entrega: { tipo: "envio", provincia: "Córdoba" } }).cuponError?.motivo).toBe("solo_envio");
    expect(aplicarCupon(cot, p, ctx).cupon).toMatchObject({ pctAplicado: false, envioGratis: true, descuento: 0, aviso: null });
    expect(
      aplicarCupon(cot, promo({ pct: 10, envioGratis: true, provinciasEnvio: ["buenosaires"] }), { ...ctx, entrega: { tipo: "envio", provincia: "Córdoba" } }).cupon,
    ).toMatchObject({ pctAplicado: true, envioGratis: false });
  });

  it("motivoCuenta corta antes que todo", () => {
    expect(aplicarCupon(cot, promo(), { ...ctx, motivoCuenta: "lista_privada" }).cuponError?.motivo).toBe("lista_privada");
  });

  it("congelado ignora vigencia, mínimo y cuenta, pero no la elegibilidad", () => {
    const vieja = promo({ fin: "2026-01-01T00:00:00-03:00", inicio: "2025-12-01T00:00:00-03:00", minimo: 1e9, activa: false });
    const r = aplicarCupon(cot, vieja, { ...ctx, congelado: true, motivoCuenta: "no_primera_compra" });
    expect(r.cupon?.pctAplicado).toBe(true);
    const r2 = aplicarCupon(cot, { ...vieja, medios: ["transferencia"] }, { ...ctx, congelado: true, opcion: { slug: "efectivo", forma: null, cuotasSinInteres: false } });
    expect(r2.cuponError?.motivo).toBe("opcion_no_elegible");
  });

  it("sin medio elegido (carrito): aplica y avisa la restricción de pago", () => {
    const r = aplicarCupon(cot, promo({ medios: ["transferencia"] }), { ...ctx, opcion: null });
    expect(r.cupon).toMatchObject({ pctAplicado: true, descuento: 242, aviso: "Su cupón es válido sólo pagando con Transferencia." });
    expect(aplicarCupon(cot, promo(), { ...ctx, opcion: null }).cupon?.aviso).toBeNull();
  });

  it("sin verificar (invitado): aplica y avisa", () => {
    expect(aplicarCupon(cot, promo(), { ...ctx, verificado: false }).cupon).toMatchObject({ verificado: false, aviso: "Se aplicará al confirmar si corresponde." });
  });
});

describe("opcionElegible", () => {
  it("cuotas sin interés excluidas por defecto", () => {
    expect(opcionElegible({ medios: null, formas: null, permiteCuotas: false }, { slug: "mercadopago", forma: "credito", cuotasSinInteres: true })).toBe(false);
    expect(opcionElegible({ medios: null, formas: null, permiteCuotas: true }, { slug: "mercadopago", forma: "credito", cuotasSinInteres: true })).toBe(true);
  });
  it("forma filtra sólo medios con formas", () => {
    expect(opcionElegible({ medios: null, formas: ["debito"], permiteCuotas: false }, { slug: "transferencia", forma: null, cuotasSinInteres: false })).toBe(true);
    expect(opcionElegible({ medios: null, formas: ["debito"], permiteCuotas: false }, { slug: "mercadopago", forma: "credito", cuotasSinInteres: false })).toBe(false);
    expect(opcionElegible({ medios: null, formas: ["debito"], permiteCuotas: false }, { slug: "mercadopago", forma: "debito", cuotasSinInteres: false })).toBe(true);
  });
  it("medio con formas y forma desconocida: no elegible si la promoción restringe formas (fail closed)", () => {
    expect(opcionElegible({ medios: null, formas: ["debito"], permiteCuotas: false }, { slug: "mercadopago", forma: null, cuotasSinInteres: false, conFormas: true })).toBe(false);
    expect(opcionElegible({ medios: null, formas: null, permiteCuotas: false }, { slug: "mercadopago", forma: null, cuotasSinInteres: false, conFormas: true })).toBe(true);
  });
  it("medios: a_coordinar entra si no hay restricción o si está", () => {
    expect(opcionElegible({ medios: null, formas: null, permiteCuotas: false }, { slug: "a_coordinar", forma: null, cuotasSinInteres: false })).toBe(true);
    expect(opcionElegible({ medios: ["transferencia"], formas: null, permiteCuotas: false }, { slug: "a_coordinar", forma: null, cuotasSinInteres: false })).toBe(false);
  });
});

describe("motivoVigencia", () => {
  it("fin exclusivo, vence_en exacto, sin empezar y pausada", () => {
    const p = promo({ fin: "2026-11-10T00:00:00-03:00" });
    expect(motivoVigencia(p, new Date("2026-11-09T23:59:59-03:00"))).toBeNull();
    expect(motivoVigencia(p, new Date("2026-11-10T00:00:00-03:00"))).toBe("vencido");
    expect(motivoVigencia(promo({ venceEn: "2026-11-08T10:00:00Z" }), new Date("2026-11-08T09:59:59Z"))).toBeNull();
    expect(motivoVigencia(promo({ venceEn: "2026-11-08T10:00:00Z" }), new Date("2026-11-08T10:00:00Z"))).toBe("vencido");
    expect(motivoVigencia(promo(), new Date("2026-10-31T23:59:59-03:00"))).toBe("no_empezo");
    expect(motivoVigencia(promo({ activa: false }), ctx.ahora)).toBe("vencido");
  });
});

describe("normalizarCodigo", () => {
  it("acepta variantes", () => {
    for (const v of ["luz 7kq2m", "LUZ7KQ2M", "luz–7kq2m", " LUZ-7KQ2M "]) expect(normalizarCodigo(v)).toBe("LUZ7KQ2M");
    expect(normalizarCodigo("ab")).toBeNull();
    expect(normalizarCodigo("x".repeat(25))).toBeNull();
    expect(normalizarCodigo(42)).toBeNull();
    expect(normalizarCodigo("<script>")).toBe("SCRIPT");
  });
});

describe("foto del pedido", () => {
  it("cuponPedidoDesde y promoDesdePedido van y vuelven", () => {
    const p = promo({ medios: ["transferencia"], envioGratis: true, provinciasEnvio: ["buenosaires"] });
    const r = aplicarCupon(cot, p, ctx);
    const foto = cuponPedidoDesde(r.cupon!, p);
    expect(foto).toEqual({
      codigoId: "c1", codigo: "LUZ-7KQ2M", promocionId: "p1", nombre: "Bot Instagram", pct: 10, envioGratis: true,
      provinciasEnvio: ["buenosaires"], medios: ["transferencia"], formas: null, permiteCuotas: false, condiciones: "Sólo primera compra.", descuento: 242,
    });
    const vuelta = promoDesdePedido(foto);
    expect(aplicarCupon(cot, vuelta, { ...ctx, congelado: true }).cupon?.descuento).toBe(242);
  });
});
