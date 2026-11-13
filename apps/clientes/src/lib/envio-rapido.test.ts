import { describe, expect, it } from "vitest";
import { CONFIG_ENVIO_DEFAULT, configEnvioPublica, evaluarEnvio } from "./envio";
import { horarioEntregaDeConfig, type MetodoEnvioTienda } from "./envio-zona-tienda";
import { estimarEnvioPorLocalidad } from "./envio-zona-textos";

const CUADRADO = [[[[-58, -39], [-57, -39], [-57, -37.5], [-58, -37.5], [-58, -39]]]];

const metodo = (extra: Partial<MetodoEnvioTienda> = {}): MetodoEnvioTienda => ({
  id: "m1",
  slug: "envio-rapido",
  nombre: "Envío rápido",
  tipo: "tarifa_zona",
  activo: true,
  orden: 0,
  provinciaClave: "buenosaires",
  sucursalOrigen: null,
  diasOperativos: [1, 2, 3, 4, 5],
  horaCorte: "09:00",
  margenMin: 0,
  promesa: "",
  avisoFeriados: "",
  gratisAplica: false,
  itemAlegraId: "9",
  itemAlegraIva: 21,
  zonas: [{ id: "z1", nombre: "Centro", precio: 4490, orden: 0, activa: true, geometria: CUADRADO as never, entradas: [] }],
  localidades: [],
  ...extra,
});

const destino = { provinciaClave: "buenosaires", punto: { lat: -38, lon: -57.5, precision: "altura" as const } };

describe("horarioEntregaDeConfig", () => {
  it("devuelve el texto recortado o undefined", () => {
    expect(horarioEntregaDeConfig({ horarioEntrega: " entre las 14 y las 21 hs " })).toBe("entre las 14 y las 21 hs");
    for (const c of [null, undefined, "x", [], {}, { horarioEntrega: "" }, { horarioEntrega: 1 }, { horarioEntrega: "x".repeat(41) }]) {
      expect(horarioEntregaDeConfig(c)).toBeUndefined();
    }
  });
});

describe("evaluarEnvio con el horario de entrega", () => {
  it("el método resuelto lleva nombre y horario de entrega", () => {
    const e = evaluarEnvio(10000, "Buenos Aires", { ...CONFIG_ENVIO_DEFAULT, metodos: [metodo({ horarioEntrega: "antes de las 21 hs" })] }, { destino });
    expect(e.metodo?.nombre).toBe("Envío rápido");
    expect(e.metodo?.horarioEntrega).toBe("antes de las 21 hs");
    expect(e.costo).toBe(4490);
  });

  it("sin horario configurado el método no trae la clave", () => {
    const e = evaluarEnvio(10000, "Buenos Aires", { ...CONFIG_ENVIO_DEFAULT, metodos: [metodo()] }, { destino });
    expect(e.metodo).not.toHaveProperty("horarioEntrega");
  });
});

describe("flag `envio-por-zona` apagado (sin `metodos`)", () => {
  it("no hay cartel ni estimación: la ficha y el carrito quedan como siempre", () => {
    expect(estimarEnvioPorLocalidad(undefined, { localidad: "Mar del Plata", provincia: "Buenos Aires" }, new Date())).toBeNull();
    const e = evaluarEnvio(10000, "Buenos Aires", CONFIG_ENVIO_DEFAULT, { destino });
    expect(e.metodo).toBeUndefined();
    expect(e.costo).toBeUndefined();
  });

  it("la config pública nunca lleva los métodos (ni su horario)", () => {
    expect(configEnvioPublica({ ...CONFIG_ENVIO_DEFAULT, metodos: [metodo({ horarioEntrega: "x" })] })).not.toHaveProperty("metodos");
  });
});
