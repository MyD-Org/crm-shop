import { describe, expect, it, vi } from "vitest";
import { setFlag, type FlagDeTest } from "@/test/flags";
import { pagosDisponibles } from "./envio";
import { ocultarEstadoPago } from "./pago-estado-visible";
import { validarCuotasPago } from "./pagos/cuotas-validacion";
import { pagosHabilitados } from "./pagos-flag";
import { cuotasHabilitadas } from "./cuotas-flag";
import { catalogoSoloVisibles } from "./catalogo-flag";
import { flagsPublicos } from "./flags-publicos";
import { sucursalesHabilitadas } from "./sucursales-flag";
import { disponibilidadSucursalHabilitada } from "./disponibilidad-sucursal-flag";
import { pedidoAConfirmarHabilitado } from "./pedido-a-confirmar-flag";

/**
 * Tablas de combinaciones de los interruptores del Shop (Vercel Flags, mockeados
 * en src/test/setup-flags.ts). Cada flag decide una cosa y falla hacia apagado;
 * acá se fija qué pasa con las combinaciones, sobre todo las que dependen de
 * otro flag (`disponibilidad-sucursal` requiere `sucursales`).
 */

const f = (flags: Partial<Record<FlagDeTest, boolean>>) => {
  for (const [k, v] of Object.entries(flags)) setFlag(k as FlagDeTest, v);
};

describe("pagos: medios visibles en el checkout", () => {
  it.each([
    { pagos: false, tipo: "retiro", esperado: ["a_coordinar"] },
    { pagos: false, tipo: "envio", esperado: ["a_coordinar"] },
    { pagos: true, tipo: "retiro", esperado: ["transferencia", "mercadopago", "efectivo"] },
    { pagos: true, tipo: "envio", esperado: ["transferencia", "mercadopago"] },
  ] as const)("pagos=$pagos, entrega=$tipo → $esperado", async ({ pagos, tipo, esperado }) => {
    f({ pagos });
    expect(pagosDisponibles(tipo, await pagosHabilitados())).toEqual(esperado);
  });

  it.each([
    { pagos: false, estado: "pendiente", oculta: true },
    { pagos: false, estado: "pagado", oculta: false },
    { pagos: false, estado: "fallido", oculta: false },
    { pagos: true, estado: "pendiente", oculta: false },
    { pagos: true, estado: "pagado", oculta: false },
    { pagos: true, estado: "fallido", oculta: false },
  ] as const)("pagos=$pagos, pago $estado → oculta etiqueta: $oculta", async ({ pagos, estado, oculta }) => {
    f({ pagos });
    expect(ocultarEstadoPago(estado, await pagosHabilitados())).toBe(oculta);
  });

  it("pedido-a-confirmar no cambia los medios fijos: depende sólo de pagos", async () => {
    f({ pagos: false, "pedido-a-confirmar": true });
    expect(pagosDisponibles("envio", await pagosHabilitados())).toEqual(["a_coordinar"]);
    expect(await pedidoAConfirmarHabilitado()).toBe(true);
  });
});

describe("cuotas: validación del cobro según el flag", () => {
  it.each([
    // [cuotas flag, medio, cuotasMax, cuotas pedidas, resultado]
    [false, "tarjeta", 6, 12, { ok: true, cuotas: 12 }], // apagado: clamp legacy 1..24
    [false, "tarjeta", 6, 30, { ok: true, cuotas: 1 }], // apagado: fuera de 1..24 → 1
    [true, "tarjeta", 6, 12, { ok: false, motivo: "cuotas_no_disponibles" }],
    [true, "tarjeta", 6, 6, { ok: true, cuotas: 6 }],
    [true, "tarjeta", 6, undefined, { ok: true, cuotas: 1 }],
    [true, "tarjeta", 6, 1.5, { ok: false, motivo: "cuotas_no_disponibles" }],
    [true, "tarjeta", null, 12, { ok: true, cuotas: 12 }], // pedido legacy sin tope
    [true, "efectivo", 6, 12, { ok: true, cuotas: 12 }], // medio offline no se valida
  ] as const)("cuotas=%s medio=%s max=%s pide=%s → %j", async (flag, medio, cuotasMax, cuotas, esperado) => {
    f({ cuotas: flag });
    const r = validarCuotasPago({ cuotas, medio: medio as never, cuotasMax, habilitado: await cuotasHabilitadas() });
    expect(r).toEqual(esperado);
  });
});

describe("visibilidad del catálogo y cuotas públicas", () => {
  it.each([
    { solo: false, cuotas: false },
    { solo: true, cuotas: false },
    { solo: false, cuotas: true },
    { solo: true, cuotas: true },
  ])("catalogo-solo-visibles=$solo, cuotas=$cuotas", async ({ solo, cuotas }) => {
    f({ "catalogo-solo-visibles": solo, cuotas });
    expect(await catalogoSoloVisibles()).toBe(solo);
    expect(await cuotasHabilitadas()).toBe(cuotas);
    expect(await flagsPublicos()).toEqual({ soloVisibles: solo, cuotas });
  });

  it("los flags de pagos y cuotas son independientes", async () => {
    f({ pagos: true, cuotas: false });
    expect(await pagosHabilitados()).toBe(true);
    expect(await cuotasHabilitadas()).toBe(false);
    f({ pagos: false, cuotas: true });
    expect(await pagosHabilitados()).toBe(false);
    expect(await cuotasHabilitadas()).toBe(true);
  });
});

describe("sucursales y reserva por sucursal", () => {
  it.each([
    { sucursales: false, disp: false, sucEsperado: false, dispEsperado: false },
    { sucursales: false, disp: true, sucEsperado: false, dispEsperado: false }, // requiere sucursales
    { sucursales: true, disp: false, sucEsperado: true, dispEsperado: false },
    { sucursales: true, disp: true, sucEsperado: true, dispEsperado: true },
  ])(
    "sucursales=$sucursales, disponibilidad-sucursal=$disp",
    async ({ sucursales, disp, sucEsperado, dispEsperado }) => {
      f({ sucursales, "disponibilidad-sucursal": disp });
      expect(await sucursalesHabilitadas()).toBe(sucEsperado);
      expect(await disponibilidadSucursalHabilitada()).toBe(dispEsperado);
    },
  );

  it("pedido-a-confirmar no depende de sucursales", async () => {
    f({ sucursales: false, "pedido-a-confirmar": true });
    expect(await pedidoAConfirmarHabilitado()).toBe(true);
    f({ sucursales: true, "pedido-a-confirmar": false });
    expect(await pedidoAConfirmarHabilitado()).toBe(false);
  });

  it("si Vercel Flags tira, sucursales, reserva y pedido a confirmar caen a apagado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/flags", () => ({
      sucursalesFlag: async () => {
        throw new Error("flags caído");
      },
      disponibilidadSucursalFlag: async () => true,
      pedidoAConfirmarFlag: async () => {
        throw new Error("flags caído");
      },
    }));
    const suc = await import("./sucursales-flag");
    const disp = await import("./disponibilidad-sucursal-flag");
    const conf = await import("./pedido-a-confirmar-flag");
    expect(await suc.sucursalesHabilitadas()).toBe(false);
    expect(await disp.disponibilidadSucursalHabilitada()).toBe(false);
    expect(await conf.pedidoAConfirmarHabilitado()).toBe(false);
    vi.doUnmock("@/flags");
    vi.restoreAllMocks();
  });
});
