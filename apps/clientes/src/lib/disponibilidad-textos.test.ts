import { describe, expect, it } from "vitest";
import {
  textoEnvio,
  textoRetiro,
  textosDisponibilidad,
} from "./disponibilidad-textos";

describe("textos de disponibilidad", () => {
  it("envío disponible, con traslado y sin stock", () => {
    expect(
      textoEnvio({ estado: "disponible", origen: "a", demoraDias: null }),
    ).toBe("Envío: disponible");
    expect(textoEnvio({ estado: "a_traer", origen: "b", demoraDias: 7 })).toBe(
      "Envío: disponible con demora de 7 días",
    );
    expect(textoEnvio({ estado: "a_traer", origen: "b", demoraDias: 1 })).toBe(
      "Envío: disponible con demora de 1 día",
    );
    expect(textoEnvio({ estado: "a_traer", origen: "b", demoraDias: 0 })).toBe(
      "Envío: disponible a coordinar",
    );
    expect(
      textoEnvio({ estado: "sin_stock", origen: null, demoraDias: null }),
    ).toBe("Envío: no disponible");
    expect(
      textoEnvio({ estado: "no_servible", origen: null, demoraDias: null }),
    ).toBe("Envío: no disponible");
  });

  it("retiro disponible, con demora y no disponible (sin stock u oculto)", () => {
    expect(
      textoRetiro("Sede A", {
        estado: "disponible",
        desde: null,
        demoraDias: null,
      }),
    ).toBe("Retiro en Sede A: disponible");
    expect(
      textoRetiro("Sede A", {
        estado: "con_demora",
        desde: "b",
        demoraDias: 7,
      }),
    ).toBe("Retiro en Sede A: con demora de 7 días");
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

  it("una línea por modalidad, en el orden de los locales", () => {
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
      "Envío: disponible",
      "Retiro en Sede B: con demora de 7 días",
      "Retiro en Sede A: disponible",
    ]);
  });

  it("sin envío ni retiro no hay texto", () => {
    expect(
      textosDisponibilidad({ servible: true, envio: null, retiro: null }, []),
    ).toEqual([]);
  });
});
