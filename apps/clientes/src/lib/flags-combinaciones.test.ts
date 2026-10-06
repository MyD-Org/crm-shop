import { describe, expect, it, vi } from "vitest";
import { setFlag, type FlagDeTest } from "@/test/flags";
import { validarCuotasPago } from "./pagos/cuotas-validacion";
import { cuotasHabilitadas } from "./cuotas-flag";
import { catalogoSoloVisibles } from "./catalogo-flag";
// Los medios con precio no son parte de esta tabla: se fijan sin base.
vi.mock("./medios-pago-datos", () => ({ mediosOfrecibles: async () => [] }));

import { flagsPublicos } from "./flags-publicos";
import { sucursalesHabilitadas } from "./sucursales-flag";
import { disponibilidadSucursalHabilitada } from "./disponibilidad-sucursal-flag";
import { busquedaIaHabilitada } from "./busqueda-ia-flag";
import { busquedaMotorUnico } from "./busqueda-motor-flag";
import { etapasDe } from "./busqueda-v2/motor";
import { planVacio, type PlanBusqueda } from "./busqueda-v2/plan";
// El cableado del motor lee catálogo y flags: acá sólo se necesita `politicaDe` (pura).
vi.mock("./catalog", () => ({ PRODUCTOS_POR_PAGINA: 24, getPaginaCatalogo: vi.fn(), contarCatalogo: vi.fn() }));
vi.mock("./catalogo-publico", () => ({ paginaCatalogoPublica: vi.fn(), facetasPublicas: vi.fn() }));
vi.mock("./busqueda-v2/servidor", () => ({ planParaPagina: vi.fn() }));
import { politicaDe } from "./busqueda-v2/motor-servidor";

/**
 * Tablas de combinaciones de los interruptores del Shop (Vercel Flags, mockeados
 * en src/test/setup-flags.ts). Cada flag decide una cosa y falla hacia apagado;
 * acá se fija qué pasa con las combinaciones, sobre todo las que dependen de
 * otro flag (`disponibilidad-sucursal` requiere `sucursales`).
 */

const f = (flags: Partial<Record<FlagDeTest, boolean>>) => {
  for (const [k, v] of Object.entries(flags)) setFlag(k as FlagDeTest, v);
};

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
    expect(await flagsPublicos()).toMatchObject({ soloVisibles: solo, cuotas });
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

  it("si Vercel Flags tira, sucursales y reserva caen a apagado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/flags", () => ({
      sucursalesFlag: async () => {
        throw new Error("flags caído");
      },
      disponibilidadSucursalFlag: async () => true,
    }));
    const suc = await import("./sucursales-flag");
    const disp = await import("./disponibilidad-sucursal-flag");
    expect(await suc.sucursalesHabilitadas()).toBe(false);
    expect(await disp.disponibilidadSucursalHabilitada()).toBe(false);
    vi.doUnmock("@/flags");
    vi.restoreAllMocks();
  });
});

describe("búsqueda: motor único x búsqueda inteligente", () => {
  const plan: PlanBusqueda = {
    ...planVacio("panel led"),
    blandos: { categorias: [{ nombre: "Paneles", peso: 0.9 }], atributos: [], terminos: [{ texto: "panel", peso: 1 }] },
  };

  it.each([
    // busqueda-motor-unico, busqueda-ia, política, etapas del autocompletar con un plan que aporta
    { motor: false, ia: false, politica: "legado", etapas: ["exacta", "tolerante"] },
    { motor: false, ia: true, politica: "legado", etapas: ["plan", "exacta", "tolerante"] },
    { motor: true, ia: false, politica: "cascada", etapas: ["exacta", "tolerante"] }, // busqueda-ia apagado manda: sin plan
    { motor: true, ia: true, politica: "cascada", etapas: ["plan", "exacta", "tolerante"] },
  ])("motor=$motor, busqueda-ia=$ia => política $politica, etapas $etapas", async ({ motor, ia, politica, etapas }) => {
    f({ "busqueda-motor-unico": motor, "busqueda-ia": ia });
    const conMotor = await busquedaMotorUnico();
    const conIa = await busquedaIaHabilitada();
    expect([conMotor, conIa]).toEqual([motor, ia]);
    expect(politicaDe("autocompletar", conMotor)).toBe(politica);
    expect(etapasDe({ politica: politicaDe("autocompletar", conMotor), superficie: "autocompletar", consulta: "panel led", plan: conIa ? plan : null, conPlan: conIa })).toEqual(etapas);
  });

  it("el chat y el admin siguen en legado con el motor prendido (hasta el cambio siguiente)", () => {
    expect(politicaDe("chat", true)).toBe("legado");
    expect(politicaDe("admin", true)).toBe("legado");
  });

  it("si Vercel Flags tira, el motor cae a apagado (legado)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/flags", () => ({
      busquedaMotorUnicoFlag: async () => {
        throw new Error("flags caído");
      },
    }));
    const motor = await import("./busqueda-motor-flag");
    expect(await motor.busquedaMotorUnico()).toBe(false);
    vi.doUnmock("@/flags");
    vi.restoreAllMocks();
  });
});
