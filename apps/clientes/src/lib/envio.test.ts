import { describe, expect, it } from "vitest";
import { fmtPesosEnteros } from "./format";
import {
  CONFIG_ENVIO_DEFAULT,
  PAGO_LABEL,
  costoEnvio,
  esEnvioACoordinar,
  etiquetaEntrega,
  evaluarEnvio,
  progresoEnvioGratis,
  textoEnvioFicha,
  textoRegla,
  type ConfigEnvio,
} from "./envio";

/**
 * Estas reglas las comparten el checkout (client component) y la validación del
 * servidor. Si se desalinean, el shop muestra una opción que la API después
 * rechaza — el cliente completa todo el formulario y se come el error al final.
 */

const GRATIS_MISIONES: ConfigEnvio = {
  domicilioActivo: true,
  gratis: { alcance: "provincias", provincias: ["misiones"], minimo: 100_000 },
};

describe("evaluarEnvio", () => {
  it("con el envío gratis apagado todo envío es a coordinar", () => {
    const r = evaluarEnvio(500_000, "misiones", CONFIG_ENVIO_DEFAULT);
    expect(r).toEqual({
      disponible: true,
      gratis: false,
      aCoordinar: true,
      motivo: "gratis_apagado",
      faltante: 0,
    });
  });

  it("gratis en la provincia del alcance con el mínimo cumplido", () => {
    const r = evaluarEnvio(120_000, "misiones", GRATIS_MISIONES);
    expect(r.gratis).toBe(true);
    expect(r.aCoordinar).toBe(false);
    expect(r.motivo).toBeNull();
    expect(r.faltante).toBe(0);
  });

  it("bajo el mínimo: disponible, no gratis, y dice cuánto falta", () => {
    const r = evaluarEnvio(50_000, "misiones", GRATIS_MISIONES);
    expect(r).toMatchObject({ disponible: true, gratis: false, aCoordinar: true, motivo: "bajo_minimo", faltante: 50_000 });
  });

  it("provincia fuera del alcance", () => {
    const r = evaluarEnvio(500_000, "salta", GRATIS_MISIONES);
    expect(r).toMatchObject({ disponible: true, gratis: false, aCoordinar: true, motivo: "fuera_de_alcance", faltante: 0 });
  });

  it("todo el país sin mínimo es gratis con cualquier subtotal", () => {
    const cfg: ConfigEnvio = { domicilioActivo: true, gratis: { alcance: "pais", provincias: [], minimo: null } };
    expect(evaluarEnvio(1, "salta", cfg).gratis).toBe(true);
  });

  it("todo el país con mínimo: sólo por encima del mínimo", () => {
    const cfg: ConfigEnvio = { domicilioActivo: true, gratis: { alcance: "pais", provincias: [], minimo: 80_000 } };
    expect(evaluarEnvio(80_000, "salta", cfg).gratis).toBe(true);
    expect(evaluarEnvio(79_999, "salta", cfg)).toMatchObject({ gratis: false, motivo: "bajo_minimo", faltante: 1 });
  });

  it("sin provincia y alcance por provincias: nunca gratis, motivo sin_ubicacion", () => {
    const r = evaluarEnvio(500_000, null, GRATIS_MISIONES);
    expect(r).toMatchObject({ disponible: true, gratis: false, aCoordinar: true, motivo: "sin_ubicacion", faltante: 0 });
  });

  it("en el borde del mínimo exacto es gratis", () => {
    expect(evaluarEnvio(100_000, "misiones", GRATIS_MISIONES).gratis).toBe(true);
  });

  it("con el domicilio inactivo no está disponible", () => {
    const r = evaluarEnvio(500_000, "misiones", { ...GRATIS_MISIONES, domicilioActivo: false });
    expect(r).toMatchObject({ disponible: false, gratis: false, aCoordinar: false, motivo: "inactivo" });
  });

  it("normaliza la provincia (acentos, mayúsculas, 'Provincia de')", () => {
    const cfg: ConfigEnvio = {
      domicilioActivo: true,
      gratis: { alcance: "provincias", provincias: ["cordoba"], minimo: null },
    };
    expect(evaluarEnvio(1, "Córdoba", cfg).gratis).toBe(true);
    expect(evaluarEnvio(1, "provincia de CORDOBA", cfg).gratis).toBe(true);
    expect(evaluarEnvio(1, "Narnia", cfg).motivo).toBe("sin_ubicacion");
  });

  it("alcance por provincias sin ninguna cargada nunca es gratis", () => {
    const cfg: ConfigEnvio = { domicilioActivo: true, gratis: { alcance: "provincias", provincias: [], minimo: null } };
    expect(evaluarEnvio(1_000_000, "misiones", cfg).motivo).toBe("fuera_de_alcance");
  });
});

describe("textoRegla", () => {
  it("gratis apagado: costo a coordinar", () => {
    expect(textoRegla(CONFIG_ENVIO_DEFAULT)).toBe("El envío a domicilio tiene costo a coordinar.");
  });

  it("inactivo", () => {
    expect(textoRegla({ ...GRATIS_MISIONES, domicilioActivo: false })).toContain("no está disponible");
  });

  it("provincias con mínimo", () => {
    const t = textoRegla(GRATIS_MISIONES);
    expect(t).toContain("Misiones");
    expect(t).toContain("100.000");
    expect(t).toContain("sin impuestos");
    expect(t).toContain("a coordinar");
  });

  it("todo el país sin mínimo", () => {
    const t = textoRegla({ domicilioActivo: true, gratis: { alcance: "pais", provincias: [], minimo: null } });
    expect(t).toContain("todo el país");
    expect(t).not.toContain("compras desde");
  });

  it("lista varias provincias", () => {
    const t = textoRegla({
      domicilioActivo: true,
      gratis: { alcance: "provincias", provincias: ["misiones", "corrientes"], minimo: null },
    });
    expect(t).toContain("Misiones y Corrientes");
  });

  it("cambia el mínimo, cambia el texto", () => {
    const cfg = (m: number): ConfigEnvio => ({
      domicilioActivo: true,
      gratis: { alcance: "pais", provincias: [], minimo: m },
    });
    expect(textoRegla(cfg(150_000))).toContain("150.000");
  });
});

describe("progresoEnvioGratis (barra del carrito)", () => {
  it("falta monto: dice cuánto y el porcentaje", () => {
    expect(progresoEnvioGratis(60_000, "misiones", GRATIS_MISIONES)).toEqual({ faltante: 40_000, pct: 60, alcanzado: false });
  });

  it("mínimo alcanzado: estado alcanzado, sin faltante", () => {
    expect(progresoEnvioGratis(100_000, "Misiones", GRATIS_MISIONES)).toEqual({ faltante: 0, pct: 100, alcanzado: true });
  });

  it("no aplica: sin ubicación, fuera de alcance, sin mínimo, apagado, inactivo, sin subtotal", () => {
    expect(progresoEnvioGratis(60_000, null, GRATIS_MISIONES)).toBeNull();
    expect(progresoEnvioGratis(60_000, "salta", GRATIS_MISIONES)).toBeNull();
    const sinMinimo: ConfigEnvio = { domicilioActivo: true, gratis: { alcance: "pais", provincias: [], minimo: null } };
    expect(progresoEnvioGratis(60_000, "misiones", sinMinimo)).toBeNull();
    expect(progresoEnvioGratis(60_000, "misiones", CONFIG_ENVIO_DEFAULT)).toBeNull();
    expect(progresoEnvioGratis(60_000, "misiones", { ...GRATIS_MISIONES, domicilioActivo: false })).toBeNull();
    expect(progresoEnvioGratis(null, "misiones", GRATIS_MISIONES)).toBeNull();
  });

  it("todo el país con mínimo no necesita ubicación", () => {
    const cfg: ConfigEnvio = { domicilioActivo: true, gratis: { alcance: "pais", provincias: [], minimo: 80_000 } };
    expect(progresoEnvioGratis(20_000, null, cfg)).toEqual({ faltante: 60_000, pct: 25, alcanzado: false });
  });
});

describe("textoEnvioFicha", () => {
  it("inactivo: sin fila", () => {
    expect(textoEnvioFicha({ ...GRATIS_MISIONES, domicilioActivo: false }, "misiones")).toBeNull();
  });

  it("gratis apagado: costo a coordinar", () => {
    expect(textoEnvioFicha(CONFIG_ENVIO_DEFAULT, "misiones")).toBe("Costo de envío a coordinar");
  });

  it("en alcance con mínimo", () => {
    expect(textoEnvioFicha(GRATIS_MISIONES, "Misiones")).toBe(
      `Gratis desde ${fmtPesosEnteros(100_000)} sin impuestos · si no, costo a coordinar`,
    );
  });

  it("en alcance sin mínimo: gratis a la localidad", () => {
    const cfg: ConfigEnvio = { domicilioActivo: true, gratis: { alcance: "provincias", provincias: ["misiones"], minimo: null } };
    expect(textoEnvioFicha(cfg, "misiones", "Posadas")).toBe("Gratis a Posadas");
    expect(textoEnvioFicha(cfg, "misiones")).toBe("Envío gratis");
  });

  it("fuera de alcance: costo a coordinar", () => {
    expect(textoEnvioFicha(GRATIS_MISIONES, "salta")).toBe("Costo de envío a coordinar");
  });

  it("sin ubicación y alcance por provincias: la regla general, sin pedir datos", () => {
    const t = textoEnvioFicha(GRATIS_MISIONES, null)!;
    expect(t).toContain("Gratis en Misiones");
    expect(t).toContain("costo de envío a coordinar");
  });

  it("todo el país no necesita ubicación", () => {
    const cfg: ConfigEnvio = { domicilioActivo: true, gratis: { alcance: "pais", provincias: [], minimo: null } };
    expect(textoEnvioFicha(cfg, null)).toBe("Envío gratis");
  });
});

describe("costoEnvio", () => {
  it("el envío online siempre cuesta 0", () => {
    expect(costoEnvio()).toBe(0);
  });
});

describe("etiqueta de a_coordinar", () => {
  it("la etiqueta que ve el cliente habla de un asesor", () => {
    expect(PAGO_LABEL.a_coordinar).toBe("A coordinar con un asesor");
  });
});

describe("envío a coordinar", () => {
  it("es un envío sin ciudad ni dirección", () => {
    expect(esEnvioACoordinar("envio", undefined, undefined)).toBe(true);
    expect(esEnvioACoordinar("envio", " ", "")).toBe(true);
    expect(esEnvioACoordinar("envio", "Puerto Iguazú", "Av. San Martín 1234")).toBe(false);
    // Con uno solo de los dos es un envío a domicilio incompleto, no a coordinar.
    expect(esEnvioACoordinar("envio", "Puerto Iguazú", undefined)).toBe(false);
    expect(esEnvioACoordinar("retiro", undefined, undefined)).toBe(false);
  });

  it("la etiqueta del pedido lo distingue del envío a domicilio", () => {
    expect(etiquetaEntrega("envio", null, null)).toBe("Envío a coordinar");
    expect(etiquetaEntrega("envio", "El Dorado", "Calle 1")).toBe("Envío a domicilio");
    expect(etiquetaEntrega("retiro")).toBe("Retiro en local");
  });
});
