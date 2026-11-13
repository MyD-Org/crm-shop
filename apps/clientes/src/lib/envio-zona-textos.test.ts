import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fmtPesosEnteros } from "./format";
import type { MetodoEnvioTienda as MetodoEnvio } from "./envio-zona-tienda";
import { TEXTOS_ENVIO_ZONA, estimarEnvioPorLocalidad, estimarEnvioPorPunto, llegadaEstimada, textoCuentaRegresiva, textoLineaLlegada, textoLlegada } from "./envio-zona-textos";

// Cuadrado grande alrededor de Mar del Plata ([lon, lat]).
const CUADRADO = [[[[-58, -39], [-57, -39], [-57, -37.5], [-58, -37.5], [-58, -39]]]];

const metodo = (extra: Partial<MetodoEnvio> = {}): MetodoEnvio => ({
  id: "m1",
  slug: "envio-en-el-dia",
  nombre: "Envío en el día",
  tipo: "tarifa_zona",
  activo: true,
  orden: 0,
  provinciaClave: "buenosaires",
  sucursalOrigen: null,
  diasOperativos: [1, 2, 3, 4, 5],
  horaCorte: "09:00",
  margenMin: 0,
  promesa: "",
  avisoFeriados: "  Los feriados no hay entregas.  ",
  gratisAplica: false,
  itemAlegraId: "9",
  itemAlegraIva: 21,
  zonas: [
    { id: "z1", nombre: "Centro", precio: 4500, orden: 0, activa: true, geometria: CUADRADO as never, entradas: [] },
  ],
  localidades: [
    { georefId: "1", etiqueta: "Mar del Plata", nombreNorm: "mardelplata", abreviaturas: ["mdp"], centro: { lat: -38, lon: -57.5 }, bbox: { sur: -38.1, oeste: -57.7, norte: -37.9, este: -57.4 } },
  ],
  ...extra,
});

const MDP = { localidad: "Mar del Plata", provincia: "Buenos Aires", id: "1" };
// Lunes 2026-11-16 11:00 (hora argentina = UTC-3).
const LUNES_11 = new Date("2026-11-16T14:00:00Z");
const LUNES_8 = new Date("2026-11-16T11:00:00Z");

describe("estimarEnvioPorLocalidad", () => {
  it("toda la localidad en una zona: precio exacto", () => {
    const e = estimarEnvioPorLocalidad([metodo()], MDP, LUNES_11)!;
    expect(e.tipo).toBe("exacto");
    expect(e.texto).toBe(`Llega mañana por ${fmtPesosEnteros(4500)}`);
    expect(e.metodo).toBe("Envío en el día");
    expect(e.avisoFeriados).toBe("Los feriados no hay entregas.");
  });

  it("la localidad toca dos zonas: «desde» el mínimo", () => {
    const m = metodo({
      zonas: [
        { id: "z1", nombre: "Centro", precio: 4500, orden: 0, activa: true, geometria: [[[[-57.55, -38.05], [-57.45, -38.05], [-57.45, -37.95], [-57.55, -37.95], [-57.55, -38.05]]]] as never, entradas: [] },
        { id: "z2", nombre: "Periferia", precio: 7000, orden: 1, activa: true, geometria: [[[[-57.65, -38.08], [-57.5, -38.08], [-57.5, -37.92], [-57.65, -37.92], [-57.65, -38.08]]]] as never, entradas: [] },
      ],
    });
    const e = estimarEnvioPorLocalidad([m], MDP, LUNES_11)!;
    expect(e.tipo).toBe("desde");
    expect(e.texto).toBe("Llega mañana");
    expect(e.zonas?.map((z) => z.nombre)).toEqual(["Centro", "Periferia"]);
  });

  it("encuentra la localidad por nombre cuando no hay id de Georef", () => {
    expect(estimarEnvioPorLocalidad([metodo()], { localidad: "mar del plata", provincia: "Buenos Aires" }, LUNES_11)).not.toBeNull();
  });

  it("sin método, método inactivo, otra provincia o localidad que no atiende: null", () => {
    expect(estimarEnvioPorLocalidad(undefined, MDP, LUNES_11)).toBeNull();
    expect(estimarEnvioPorLocalidad([], MDP, LUNES_11)).toBeNull();
    expect(estimarEnvioPorLocalidad([metodo({ activo: false })], MDP, LUNES_11)).toBeNull();
    expect(estimarEnvioPorLocalidad([metodo()], { ...MDP, provincia: "Córdoba" }, LUNES_11)).toBeNull();
    expect(estimarEnvioPorLocalidad([metodo()], { localidad: "Tandil", provincia: "Buenos Aires", id: "55" }, LUNES_11)).toBeNull();
    expect(estimarEnvioPorLocalidad([metodo()], null, LUNES_11)).toBeNull();
  });
});

describe("llegadaEstimada", () => {
  const horario = { dias: [1, 2, 3, 4, 5], horaCorte: "09:00", margenMin: 0 };

  it("antes del corte con pago en línea: llega hoy, con la cuenta regresiva al corte", () => {
    const l = llegadaEstimada(horario, LUNES_8);
    expect(l.texto).toBe("Llega hoy");
    expect(l.mismoDia).toBe(true);
    expect(l.condicion).toBe(textoCuentaRegresiva(60));
  });

  it("cuenta regresiva como Mercado Libre", () => {
    expect(textoCuentaRegresiva(40)).toBe("Comprando dentro de los próximos 40 min");
    expect(textoCuentaRegresiva(60)).toBe("Comprando dentro de las próximas 1 h");
    expect(textoCuentaRegresiva(135)).toBe("Comprando dentro de las próximas 2 h 15 min");
    expect(textoCuentaRegresiva(0)).toBeNull();
  });

  it("después del corte: llega mañana", () => {
    expect(llegadaEstimada(horario, LUNES_11).texto).toBe("Llega mañana");
  });

  it("viernes tarde: llega el lunes", () => {
    const viernes = new Date("2026-11-13T15:00:00Z");
    expect(llegadaEstimada(horario, viernes).texto).toBe("Llega el lunes 16/11");
  });

  it("sin pago en línea nunca promete el mismo día", () => {
    const l = llegadaEstimada(horario, LUNES_8, false);
    expect(l.mismoDia).toBe(false);
    expect(l.texto).toBe("Llega mañana");
  });
});

describe("envío rápido: nombre del método y horario de entrega", () => {
  const horario = { dias: [1, 2, 3, 4, 5], horaCorte: "09:00", margenMin: 0 };
  const P = fmtPesosEnteros(4500);

  it("con horario: «Llega hoy antes de las 21 hs por $ …»", () => {
    const l = llegadaEstimada(horario, LUNES_8, true, "antes de las 21 hs");
    expect(l.texto).toBe("Llega hoy antes de las 21 hs");
    expect(textoLineaLlegada(l.texto, undefined, 4500)).toBe(`Llega hoy antes de las 21 hs por ${P}`);
    expect(l.condicion).toBe("Comprando dentro de las próximas 1 h");
  });

  it("con horario y otra fecha: «Llega el lunes 16/11 antes de las 21 hs»", () => {
    const viernes = new Date("2026-11-13T15:00:00Z");
    expect(llegadaEstimada(horario, viernes, true, "antes de las 21 hs").texto).toBe("Llega el lunes 16/11 antes de las 21 hs");
  });

  it("sin horario (o vacío): «Llega el lunes 16/11 por $ …»", () => {
    const viernes = new Date("2026-11-13T15:00:00Z");
    for (const h of [undefined, "", "  "]) {
      const l = llegadaEstimada(horario, viernes, true, h);
      expect(textoLineaLlegada(l.texto, undefined, 4500)).toBe(`Llega el lunes 16/11 por ${P}`);
    }
  });

  it("la ficha lleva el nombre del método y el horario configurado", () => {
    const e = estimarEnvioPorLocalidad([metodo({ nombre: "Envío rápido", horarioEntrega: "antes de las 21 hs" })], MDP, LUNES_8)!;
    expect(e.metodo).toBe("Envío rápido");
    expect(e.texto).toBe(`Llega hoy antes de las 21 hs por ${P}`);
    expect(e.texto).not.toContain("Envío en el día");
  });

  it("varias zonas: sin precio en la línea principal (las tarifas van debajo)", () => {
    const m = metodo({
      horarioEntrega: "entre las 14 y las 21 hs",
      zonas: [
        { id: "z1", nombre: "Centro", precio: 4500, orden: 0, activa: true, geometria: [[[[-57.55, -38.05], [-57.45, -38.05], [-57.45, -37.95], [-57.55, -37.95], [-57.55, -38.05]]]] as never, entradas: [] },
        { id: "z2", nombre: "Periferia", precio: 7000, orden: 1, activa: true, geometria: [[[[-57.65, -38.08], [-57.5, -38.08], [-57.5, -37.92], [-57.65, -37.92], [-57.65, -38.08]]]] as never, entradas: [] },
      ],
    });
    const e = estimarEnvioPorLocalidad([m], MDP, LUNES_11)!;
    expect(e.tipo).toBe("desde");
    expect(e.texto).toBe("Llega mañana entre las 14 y las 21 hs");
  });

  it("por punto exacto también usa el horario", () => {
    const punto = { provinciaClave: "buenosaires", punto: { lat: -38, lon: -57.5, precision: "altura" as const } };
    const e = estimarEnvioPorPunto([metodo({ horarioEntrega: "antes de las 21 hs" })], punto, LUNES_8)!;
    expect(e.texto).toBe(`Llega hoy antes de las 21 hs por ${P}`);
  });
});

describe("textoLlegada", () => {
  it("mismo día, mañana y otra fecha", () => {
    expect(textoLlegada({ fecha: "2026-11-16", mismoDia: true }, "2026-11-17")).toBe("Llega hoy");
    expect(textoLlegada({ fecha: "2026-11-17", mismoDia: false }, "2026-11-17")).toBe("Llega mañana");
    expect(textoLlegada({ fecha: "2026-11-19", mismoDia: false }, "2026-11-17")).toBe("Llega el jueves 19/11");
  });
});

describe("registro de los textos", () => {
  it("todos en usted: sin tuteo ni voseo", () => {
    const todos = Object.values(TEXTOS_ENVIO_ZONA).join(" ");
    expect(todos).not.toMatch(/\b(tu|tus|te|vos|elegí|seleccioná|ingresá|revisá)\b/i);
    expect(readFileSync(new URL("./envio-zona-textos.ts", import.meta.url), "utf8")).toBeTruthy();
  });
});

describe("textoEntregaPedido", () => {
  it("con fecha confirmada manda esa", async () => {
    const { textoEntregaPedido } = await import("./envio-zona-textos");
    expect(textoEntregaPedido({ entregaEstimada: "2026-11-16", entregaConfirmada: "2026-11-17", medioOnline: true })).toBe("Entrega prevista: martes 17/11");
  });
  it("sin confirmar es una estimación que cuenta desde la confirmación del pago", async () => {
    const { textoEntregaPedido } = await import("./envio-zona-textos");
    expect(textoEntregaPedido({ entregaEstimada: "2026-11-16", entregaConfirmada: null, medioOnline: false })).toBe(
      "Entrega estimada: lunes 16/11, a partir de la confirmación de su pago",
    );
  });
  it("sin fechas: null", async () => {
    const { textoEntregaPedido } = await import("./envio-zona-textos");
    expect(textoEntregaPedido({ entregaEstimada: null, entregaConfirmada: null, medioOnline: true })).toBeNull();
  });
});
