import { describe, expect, it } from "vitest";
import { armarEnvioPedido, estimarEntrega, horarioDeDetalle, origenCompatible } from "./envio-snapshot";
import { cotizarMetodo } from "./envio-zona";
import { metodoDePrueba, puntoDePrueba } from "@/test/envio-metodo";

const CTX = { origen: { sucursal: "mdp", conTraslado: false }, subtotalSinIva: 10_000, gratisTienda: false, gratisCupon: false };
// Martes 2026-11-10 08:00 hora argentina (11:00 UTC): antes del corte de las 09:00.
const MARTES_8 = new Date("2026-11-10T11:00:00Z");
// Martes 10:00 (después del corte).
const MARTES_10 = new Date("2026-11-10T13:00:00Z");

describe("estimarEntrega", () => {
  const horario = { dias: [1, 2, 3, 4, 5], horaCorte: "09:00", margenMin: 0 };

  it("pago en línea antes del corte: el mismo día", () => {
    expect(estimarEntrega(MARTES_8, horario, true)).toEqual({ fecha: "2026-11-10", mismoDia: true });
  });

  it("pago en línea después del corte: el siguiente día operativo", () => {
    expect(estimarEntrega(MARTES_10, horario, true)).toEqual({ fecha: "2026-11-11", mismoDia: false });
  });

  it("pago NO en línea: nunca promete el mismo día (la confirmación llega después)", () => {
    expect(estimarEntrega(MARTES_8, horario, false)).toEqual({ fecha: "2026-11-11", mismoDia: false });
  });

  it("pago NO en línea un viernes antes del corte: el lunes", () => {
    const viernes8 = new Date("2026-11-13T11:00:00Z");
    expect(estimarEntrega(viernes8, horario, false)).toEqual({ fecha: "2026-11-16", mismoDia: false });
  });
});

describe("armarEnvioPedido", () => {
  const m = metodoDePrueba();
  const resultado = cotizarMetodo(m, { provinciaClave: "buenosaires", punto: puntoDePrueba("centro") }, CTX)!;

  it("congela método, zona, regla, precio, horario, ítem de Alegra y punto", () => {
    const r = armarEnvioPedido(resultado, { punto: puntoDePrueba("centro"), medioOnline: true, ahora: MARTES_8 });
    expect(r.columnas).toEqual({
      envioMetodo: "envio-en-el-dia",
      envioZona: "Centro",
      envioPromesa: "Entrega en el día",
      envioEntregaEstimada: "2026-11-10",
    });
    expect(r.detalle).toEqual({
      v: 1,
      metodoId: "m-1",
      slug: "envio-en-el-dia",
      zonaId: "z-centro",
      zona: "Centro",
      precio: 3000,
      regla: "poligono",
      precision: "altura",
      punto: { lat: -38.0, lon: -57.58 },
      horario: { dias: [1, 2, 3, 4, 5], horaCorte: "09:00", margenMin: 0, tz: "America/Argentina/Buenos_Aires" },
      alegra: { itemId: "9001", ivaPct: 21 },
      avisoFeriados: "",
      medioOnline: true,
    });
  });

  it("sin coordenadas (regla cp o georef): punto null y precisión null", () => {
    const porCp = cotizarMetodo(m, { provinciaClave: "buenosaires", cp: "7600" }, CTX)!;
    const r = armarEnvioPedido(porCp, { punto: null, medioOnline: false, ahora: MARTES_8 });
    expect(r.detalle.punto).toBeNull();
    expect(r.detalle.precision).toBeNull();
    expect(r.detalle.regla).toBe("cp");
    expect(r.columnas.envioEntregaEstimada).toBe("2026-11-11");
  });

  it("el precio congelado es el de la tarifa aunque el envío haya salido gratis", () => {
    const gratis = cotizarMetodo(metodoDePrueba({ gratisAplica: true }), { provinciaClave: "buenosaires", punto: puntoDePrueba("centro") }, { ...CTX, gratisTienda: true })!;
    const r = armarEnvioPedido(gratis, { punto: puntoDePrueba("centro"), medioOnline: true, ahora: MARTES_8 });
    expect(gratis.costo).toBe(0);
    expect(r.detalle.precio).toBe(3000);
  });
});

describe("origenCompatible (re-verificación dentro de la transacción)", () => {
  it("método sin condición de origen: siempre", () => {
    expect(origenCompatible(null, { sucursal: "igz", conTraslado: true })).toBe(true);
  });

  it("misma sucursal y sin traslado: ok", () => {
    expect(origenCompatible("mdp", { sucursal: "mdp", conTraslado: false })).toBe(true);
  });

  it("otra sucursal o con traslado: no", () => {
    expect(origenCompatible("mdp", { sucursal: "igz", conTraslado: false })).toBe(false);
    expect(origenCompatible("mdp", { sucursal: "mdp", conTraslado: true })).toBe(false);
  });

  it("origen desconocido (sin sucursales): no se puede comprobar, se acepta", () => {
    expect(origenCompatible("mdp", null)).toBe(true);
  });
});

describe("horarioDeDetalle (lectura del snapshot que escribió el Shop o el CRM)", () => {
  const ok = { horario: { dias: [1, 2, 3, 4, 5], horaCorte: "09:00", margenMin: 30, tz: "America/Argentina/Buenos_Aires" } };

  it("devuelve el horario congelado", () => {
    expect(horarioDeDetalle(ok)).toEqual({ dias: [1, 2, 3, 4, 5], horaCorte: "09:00", margenMin: 30 });
  });

  it("rechaza lo que no sea un horario confiable (no se inventa una fecha)", () => {
    for (const malo of [
      null,
      "x",
      {},
      { horario: null },
      { horario: { dias: [], horaCorte: "09:00", margenMin: 0 } },
      { horario: { dias: [0, 8], horaCorte: "09:00", margenMin: 0 } },
      { horario: { dias: [1], horaCorte: "25:00", margenMin: 0 } },
      { horario: { dias: [1], horaCorte: "9:00", margenMin: 0 } },
      { horario: { dias: [1], horaCorte: "09:00", margenMin: -1 } },
      { horario: { dias: [1], horaCorte: "09:00" } },
    ]) {
      expect(horarioDeDetalle(malo)).toBeNull();
    }
  });
});

describe("vistaEnvioDePedido", () => {
  const fila = { envioMetodo: "envio-en-el-dia", envioZona: "Centro", envioEntregaEstimada: "2026-11-16", envioEntregaConfirmada: null, envioDetalle: { avisoFeriados: " Sin entregas en feriados. ", medioOnline: true } };

  it("resume zona, fechas, aviso y medio", async () => {
    const { vistaEnvioDePedido } = await import("./envio-snapshot");
    expect(vistaEnvioDePedido(fila)).toEqual({ zona: "Centro", entregaEstimada: "2026-11-16", entregaConfirmada: null, avisoFeriados: "Sin entregas en feriados.", medioOnline: true });
  });
  it("sin método (retiro, a coordinar o pedido viejo): null", async () => {
    const { vistaEnvioDePedido } = await import("./envio-snapshot");
    expect(vistaEnvioDePedido({ ...fila, envioMetodo: null, envioZona: null })).toBeNull();
    expect(vistaEnvioDePedido({ ...fila, envioDetalle: null })).toMatchObject({ avisoFeriados: "", medioOnline: false });
  });
});
