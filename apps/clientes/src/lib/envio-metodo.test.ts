import { describe, expect, it } from "vitest";
import { CONFIG_ENVIO_DEFAULT, evaluarEnvio, type ConfigEnvio } from "./envio";
import { metodoDePrueba, puntoDePrueba } from "@/test/envio-metodo";

const ORIGEN_OK = { sucursal: "mdp", conTraslado: false };
const DESTINO_CENTRO = { provinciaClave: "buenosaires", punto: puntoDePrueba("centro") };

const conMetodos = (metodos = [metodoDePrueba()], base: ConfigEnvio = CONFIG_ENVIO_DEFAULT): ConfigEnvio => ({
  ...base,
  metodos,
});

const GRATIS_BA: ConfigEnvio = {
  domicilioActivo: true,
  gratis: { alcance: "provincias", provincias: ["buenosaires"], minimo: 100_000 },
};

describe("evaluarEnvio con métodos de envío por zona", () => {
  it("sin métodos (o vacío) es exactamente lo de siempre: sin costo ni método", () => {
    const base = evaluarEnvio(50_000, "buenosaires", CONFIG_ENVIO_DEFAULT);
    expect(evaluarEnvio(50_000, "buenosaires", { ...CONFIG_ENVIO_DEFAULT, metodos: [] }, { destino: DESTINO_CENTRO })).toEqual(base);
    expect(base.costo).toBeUndefined();
    expect(base.metodo).toBeUndefined();
  });

  it("un método que aplica da el costo de la zona y el método", () => {
    const e = evaluarEnvio(50_000, "buenosaires", conMetodos(), { destino: DESTINO_CENTRO, origen: ORIGEN_OK });
    expect(e).toMatchObject({ disponible: true, gratis: false, aCoordinar: false, motivo: null, costo: 3000 });
    expect(e.metodo).toMatchObject({ slug: "envio-en-el-dia", zona: "Centro", precio: 3000, regla: "poligono" });
  });

  it("gratis de la tienda NO anula la tarifa si el método no aplica gratis", () => {
    const e = evaluarEnvio(150_000, "buenosaires", conMetodos([metodoDePrueba()], GRATIS_BA), {
      destino: DESTINO_CENTRO,
      origen: ORIGEN_OK,
    });
    expect(e.gratis).toBe(false);
    expect(e.costo).toBe(3000);
  });

  it("gratis de la tienda anula la tarifa si gratisAplica", () => {
    const m = metodoDePrueba({ gratisAplica: true });
    const e = evaluarEnvio(150_000, "buenosaires", conMetodos([m], GRATIS_BA), { destino: DESTINO_CENTRO, origen: ORIGEN_OK });
    expect(e).toMatchObject({ gratis: true, costo: 0 });
    expect(e.metodo?.precio).toBe(3000);
  });

  it("debajo del mínimo gratis se cobra la tarifa aunque gratisAplica", () => {
    const m = metodoDePrueba({ gratisAplica: true });
    const e = evaluarEnvio(50_000, "buenosaires", conMetodos([m], GRATIS_BA), { destino: DESTINO_CENTRO, origen: ORIGEN_OK });
    expect(e).toMatchObject({ gratis: false, costo: 3000 });
  });

  it("el cupón de envío gratis anula la tarifa sólo con gratisAplica", () => {
    const sin = evaluarEnvio(50_000, "buenosaires", conMetodos(), { destino: DESTINO_CENTRO, origen: ORIGEN_OK, gratisCupon: true });
    expect(sin).toMatchObject({ gratis: false, costo: 3000 });
    const con = evaluarEnvio(50_000, "buenosaires", conMetodos([metodoDePrueba({ gratisAplica: true })]), {
      destino: DESTINO_CENTRO,
      origen: ORIGEN_OK,
      gratisCupon: true,
    });
    expect(con).toMatchObject({ gratis: true, costo: 0 });
  });

  it("origen distinto o con traslado: el método no aplica y queda a coordinar", () => {
    for (const origen of [{ sucursal: "igz", conTraslado: false }, { sucursal: "mdp", conTraslado: true }]) {
      const e = evaluarEnvio(50_000, "buenosaires", conMetodos(), { destino: DESTINO_CENTRO, origen });
      expect(e).toMatchObject({ disponible: true, aCoordinar: true, motivo: "gratis_apagado" });
      expect(e.metodo).toBeUndefined();
      expect(e.costo ?? 0).toBe(0);
    }
  });

  it("origen desconocido (flag de disponibilidad apagado): la condición se ignora", () => {
    const e = evaluarEnvio(50_000, "buenosaires", conMetodos(), { destino: DESTINO_CENTRO });
    expect(e.costo).toBe(3000);
  });

  it("método inactivo: como si no existiera", () => {
    const e = evaluarEnvio(50_000, "buenosaires", conMetodos([metodoDePrueba({ activo: false })]), { destino: DESTINO_CENTRO });
    expect(e).toEqual(evaluarEnvio(50_000, "buenosaires", CONFIG_ENVIO_DEFAULT));
  });

  it("envío a domicilio apagado en la tienda: no hay envío ni método", () => {
    const cfg = conMetodos([metodoDePrueba()], { domicilioActivo: false, gratis: null });
    const e = evaluarEnvio(50_000, "buenosaires", cfg, { destino: DESTINO_CENTRO });
    expect(e).toMatchObject({ disponible: false, motivo: "inactivo" });
    expect(e.metodo).toBeUndefined();
  });

  it("sin zona (afuera de todo): a coordinar, nunca un precio inventado", () => {
    const e = evaluarEnvio(50_000, "buenosaires", conMetodos(), {
      destino: { provinciaClave: "buenosaires", punto: puntoDePrueba("afuera") },
      origen: ORIGEN_OK,
    });
    expect(e.aCoordinar).toBe(true);
    expect(e.metodo).toBeUndefined();
    expect(e.sinUbicar).toBeUndefined();
  });

  it("por CP sin coordenadas: aplica la zona con regla cp", () => {
    const e = evaluarEnvio(50_000, "buenosaires", conMetodos(), {
      destino: { provinciaClave: "buenosaires", cp: "7600" },
      origen: ORIGEN_OK,
    });
    expect(e.metodo).toMatchObject({ zona: "Centro", regla: "cp" });
  });

  it("sin ubicación exacta pero con una localidad que el método atiende: sinUbicar (no inventa precio)", () => {
    const e = evaluarEnvio(50_000, "buenosaires", conMetodos(), {
      destino: { provinciaClave: "buenosaires", georefId: "9990010" },
      origen: ORIGEN_OK,
    });
    expect(e.aCoordinar).toBe(true);
    expect(e.sinUbicar).toBe(true);
    expect(e.metodo).toBeUndefined();
  });

  it("sin ubicación y localidad que el método no atiende: a coordinar sin sinUbicar", () => {
    const e = evaluarEnvio(50_000, "buenosaires", conMetodos(), {
      destino: { provinciaClave: "buenosaires", georefId: "9990098" },
      origen: ORIGEN_OK,
    });
    expect(e.sinUbicar).toBeUndefined();
  });

  it("provincia del método distinta: no aplica", () => {
    const e = evaluarEnvio(50_000, "cordoba", conMetodos(), {
      destino: { provinciaClave: "cordoba", punto: puntoDePrueba("centro") },
      origen: ORIGEN_OK,
    });
    expect(e.metodo).toBeUndefined();
  });

  it("varios métodos: gana el de menor orden que aplica", () => {
    const a = metodoDePrueba({ id: "m-a", slug: "a", orden: 2 });
    const b = metodoDePrueba({ id: "m-b", slug: "b", orden: 1 });
    const e = evaluarEnvio(50_000, "buenosaires", conMetodos([a, b]), { destino: DESTINO_CENTRO });
    expect(e.metodo?.slug).toBe("b");
  });
});
