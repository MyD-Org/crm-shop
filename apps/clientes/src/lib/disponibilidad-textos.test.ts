import { describe, expect, it } from "vitest";
import {
  lineasDisponibilidad,
  textoEnvio,
  textoRetiro,
  textosDisponibilidad,
} from "./disponibilidad-textos";

describe("textos de disponibilidad", () => {
  it("envío disponible, con traslado y sin stock", () => {
    expect(
      textoEnvio({ estado: "disponible", origen: "a", demoraDias: null }),
    ).toBe("Envío a domicilio: disponible");
    expect(textoEnvio({ estado: "a_traer", origen: "b", demoraDias: 7 })).toBe(
      "Envío a domicilio: disponible en 7 días",
    );
    expect(textoEnvio({ estado: "a_traer", origen: "b", demoraDias: 1 })).toBe(
      "Envío a domicilio: disponible en 1 día",
    );
    expect(textoEnvio({ estado: "a_traer", origen: "b", demoraDias: 0 })).toBe(
      "Envío a domicilio: a coordinar",
    );
    expect(
      textoEnvio({ estado: "sin_stock", origen: null, demoraDias: null }),
    ).toBe("Envío a domicilio: no disponible");
    expect(
      textoEnvio({ estado: "no_servible", origen: null, demoraDias: null }),
    ).toBe("Envío a domicilio: no disponible");
  });

  it("retiro disponible, con demora y no disponible (sin stock u oculto)", () => {
    expect(
      textoRetiro("Sede A", {
        estado: "disponible",
        desde: null,
        demoraDias: null,
      }),
    ).toBe("Retiro en Sede A: disponible hoy");
    expect(
      textoRetiro("Sede A", {
        estado: "con_demora",
        desde: "b",
        demoraDias: 7,
      }),
    ).toBe("Retiro en Sede A: disponible en 7 días");
    expect(
      textoRetiro("Sede A", {
        estado: "con_demora",
        desde: "b",
        demoraDias: 0,
      }),
    ).toBe("Retiro en Sede A: a coordinar");
    expect(
      textoRetiro("Sede A", {
        estado: "sin_stock",
        desde: null,
        demoraDias: null,
      }),
    ).toBe("Retiro en Sede A: no disponible");
    expect(
      textoRetiro("Sede A", {
        estado: "oculto",
        desde: null,
        demoraDias: null,
      }),
    ).toBe("Retiro en Sede A: no disponible");
  });

  it("un retiro por local, en el orden de los locales, y el envío al final", () => {
    const t = textosDisponibilidad(
      {
        servible: true,
        envio: { estado: "disponible", origen: "a", demoraDias: null },
        retiro: {
          a: { estado: "disponible", desde: null, demoraDias: null },
          b: { estado: "con_demora", desde: "a", demoraDias: 7 },
        },
      },
      [
        { slug: "b", nombre: "Sede B" },
        { slug: "a", nombre: "Sede A" },
      ],
    );
    expect(t).toEqual([
      "Retiro en Sede B: disponible en 7 días",
      "Retiro en Sede A: disponible hoy",
      "Envío a domicilio: disponible",
    ]);
  });

  it("sin el flag de envío no se promete el envío y cada línea trae su tono", () => {
    const d = {
      servible: true,
      envio: { estado: "a_traer" as const, origen: "b", demoraDias: 7 },
      retiro: {
        a: { estado: "sin_stock" as const, desde: null, demoraDias: null },
        b: { estado: "con_demora" as const, desde: "a", demoraDias: 7 },
      },
    };
    const locales = [
      { slug: "a", nombre: "Sede A" },
      { slug: "b", nombre: "Sede B" },
    ];
    expect(lineasDisponibilidad(d, locales, { conEnvio: false })).toEqual([
      { texto: "Retiro en Sede A: no disponible", tono: "no" },
      { texto: "Retiro en Sede B: disponible en 7 días", tono: "demora" },
    ]);
    expect(lineasDisponibilidad(d, locales).at(-1)).toEqual({
      texto: "Envío a domicilio: disponible en 7 días",
      tono: "demora",
    });
  });

  it("sin envío ni retiro no hay texto", () => {
    expect(
      textosDisponibilidad({ servible: true, envio: null, retiro: null }, []),
    ).toEqual([]);
  });
});
