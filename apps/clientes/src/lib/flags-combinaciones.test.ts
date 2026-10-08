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
import { etapasDe } from "./busqueda-v2/motor";
import { planVacio, type PlanBusqueda } from "./busqueda-v2/plan";

/**
 * Tablas de combinaciones de los interruptores del Shop (Vercel Flags, mockeados
 * en src/test/setup-flags.ts). Cada flag decide una cosa y falla hacia apagado;
 * acá se fija qué pasa con las combinaciones, sobre todo las que dependen de
 * otro flag (`disponibilidad-sucursal` requiere `sucursales`).
 */

const f = (flags: Partial<Record<FlagDeTest, boolean>>) => {
  for (const [k, v] of Object.entries(flags)) setFlag(k as FlagDeTest, v);
};

describe("cuotas: validación del cobro según lo congelado en el pedido", () => {
  it.each([
    // [cuotas congeladas, cuotas pedidas, resultado]
    [null, 1, { ok: true, cuotas: 1 }], // sin congelar (flag apagado al crear o anterior): 1 pago
    [null, 12, { ok: false, motivo: "planes_no_disponibles" }], // más cuotas: sólo con interés de MP (planes)
    [null, 30, { ok: false, motivo: "cuotas_distintas" }],
    [6, 6, { ok: true, cuotas: 6 }],
    [6, 12, { ok: false, motivo: "cuotas_distintas" }], // igualdad estricta
    [6, 3, { ok: false, motivo: "cuotas_distintas" }],
    [6, undefined, { ok: false, motivo: "cuotas_distintas" }],
    [1, undefined, { ok: true, cuotas: 1 }],
    [6, 1.5, { ok: false, motivo: "cuotas_distintas" }],
  ] as const)("congeladas=%s pide=%s → %j", (cuotasPedido, cuotas, esperado) => {
    expect(
      validarCuotasPago({
        cuotas,
        medio: "tarjeta",
        cuotasPedido,
        procesadorId: "mercadopago",
        opcion: "credito",
        marca: "visa",
        marcasCondicion: null,
        totalPedido: 100,
        planes: null,
      }),
    ).toMatchObject(esperado);
  });
});

describe("visibilidad del catálogo y cuotas públicas", () => {
  it.each([
    { solo: false, cuotas: false },
    { solo: true, cuotas: false },
    { solo: false, cuotas: true },
    { solo: true, cuotas: true },
  ])("catalogo-solo-visibles=$solo, cuotas=$cuotas", async ({ solo, cuotas }) => {
    f({ "catalogo-solo-visibles": solo, "cuotas-cobro": cuotas });
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

describe("búsqueda: kill switch busqueda-ia sobre el motor único", () => {
  const plan: PlanBusqueda = {
    ...planVacio("panel led"),
    blandos: { categorias: [{ nombre: "Paneles", peso: 0.9 }], atributos: [], terminos: [{ texto: "panel", peso: 1 }] },
  };

  it.each([
    // busqueda-ia, etapas con un plan que aporta (en todas las superficies que usan plan)
    { ia: false, etapas: ["exacta", "tolerante"] }, // apagado: sin plan en ninguna superficie
    { ia: true, etapas: ["plan", "exacta", "tolerante"] },
  ])("busqueda-ia=$ia => etapas $etapas en catálogo, autocompletar y chat", async ({ ia, etapas }) => {
    f({ "busqueda-ia": ia });
    const conIa = await busquedaIaHabilitada();
    expect(conIa).toBe(ia);
    for (const superficie of ["catalogo", "autocompletar", "chat"] as const) {
      expect(etapasDe({ superficie, consulta: "panel led", plan: conIa ? plan : null, conPlan: conIa })).toEqual(etapas);
    }
  });

  it("el selector del admin nunca usa plan, con busqueda-ia prendido o apagado", () => {
    for (const conPlan of [false, true]) {
      expect(etapasDe({ superficie: "admin", consulta: "panel led", plan, conPlan })).toEqual(["exacta", "tolerante"]);
    }
  });

  it("busqueda-ia apagado: un código sigue yendo a la etapa de código (no depende del plan)", () => {
    expect(etapasDe({ superficie: "catalogo", consulta: "DL-18W", plan: null, conPlan: false })).toEqual(["codigo", "tolerante"]);
  });
});
