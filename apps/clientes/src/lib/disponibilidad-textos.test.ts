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

  it("con el envío desactivado no se promete el envío y cada línea trae su tono", () => {
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

describe("estados sin prefijo (lista de locales de la ficha)", () => {
  it("retiro: hoy, con plazo, a coordinar y no disponible", async () => {
    const { estadoRetiroLocal } = await import("./disponibilidad-textos");
    expect(estadoRetiroLocal({ estado: "disponible", desde: null, demoraDias: null })).toEqual({ texto: "Disponible hoy", tono: "ok" });
    expect(estadoRetiroLocal({ estado: "con_demora", desde: "b", demoraDias: 3 }).texto).toBe("Disponible en 3 días");
    expect(estadoRetiroLocal({ estado: "con_demora", desde: "b", demoraDias: 0 }).texto).toBe("A coordinar");
    expect(estadoRetiroLocal({ estado: "sin_stock", desde: null, demoraDias: null }).tono).toBe("no");
  });

  it("envío: disponible y con plazo", async () => {
    const { estadoEnvio } = await import("./disponibilidad-textos");
    expect(estadoEnvio({ estado: "disponible", origen: "a", demoraDias: null }).texto).toBe("Disponible");
    expect(estadoEnvio({ estado: "a_traer", origen: "b", demoraDias: 1 }).texto).toBe("Disponible en 1 día");
  });
});

describe("resumen del carrito", () => {
  const locales = [{ slug: "a", nombre: "A" }, { slug: "b", nombre: "B" }];
  const hoy = { estado: "disponible" as const, desde: null, demoraDias: null };
  const traer = { estado: "con_demora" as const, desde: "b", demoraDias: 7 };
  const no = { estado: "sin_stock" as const, desde: null, demoraDias: null };
  const p = (a: typeof hoy | typeof traer | typeof no, b: typeof hoy | typeof traer | typeof no) =>
    ({ envio: { estado: "disponible" as const, origen: "a", demoraDias: null }, retiro: { a, b }, servible: true }) as never;

  it("manda el producto más lento y cuenta los que se traen", async () => {
    const { resumenDisponibilidadCarrito } = await import("./disponibilidad-textos");
    const r = resumenDisponibilidadCarrito([p(hoy, hoy), p(traer, hoy), p(hoy, no)], locales)!;
    expect(r.producto.retiro!.a.estado).toBe("con_demora");
    expect(r.notasLocal.a).toBe("1 producto se trae de otra sucursal");
    expect(r.producto.retiro!.b.estado).toBe("sin_stock");
    expect(r.notasLocal.b).toBe("1 producto no está disponible en este local");
  });

  it("sin entrega posible sólo si no hay retiro ni envío", async () => {
    const { sinEntregaPosible } = await import("./disponibilidad-textos");
    expect(sinEntregaPosible({ envio: null, retiro: { a: no, b: no } } as never)).toBe(true);
    expect(sinEntregaPosible({ envio: null, retiro: { a: traer, b: no } } as never)).toBe(false);
  });
});
