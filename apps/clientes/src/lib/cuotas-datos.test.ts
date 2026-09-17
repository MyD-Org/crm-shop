import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import valido from "./__fixtures__/cuotas-contrato-v1/valido.json";
import { leerOfertaCuotas, type DepsOfertaCuotas } from "./cuotas-datos";
import type { FilaPlanesLeida, RepoCuotas } from "./cuotas-sync";
import type { PlanDeCuotas } from "./pagos/cuotas-tipos";

const AHORA = new Date("2026-09-16T15:00:00Z"); // 12:00 AR
const HACE_1H = new Date(AHORA.getTime() - 3600_000);
const HACE_13H = new Date(AHORA.getTime() - 13 * 3600_000);

const plan = (medio: string, cuotas: number, tasaPct: number): PlanDeCuotas => ({
  proveedor: "mercadopago", medio, cuotas, tasaPct, cftPct: null, teaPct: null, montoMin: null, montoMax: null,
});

let config: { payload: unknown; fetchedAt: Date | null } | null;
let filas: FilaPlanesLeida[];
let programadas: number;

function deps(repoParcial: Partial<RepoCuotas> = {}): DepsOfertaCuotas {
  return {
    repo: {
      leerConfig: async () => config,
      leerPlanes: async () => filas,
      ...repoParcial,
    } as RepoCuotas,
    tenant: "central-led",
    ahora: () => AHORA,
    programarSync: () => { programadas++; },
  };
}

beforeEach(() => {
  config = { payload: valido, fetchedAt: HACE_1H };
  filas = [
    { proveedor: "mercadopago", medio: "visa", planes: [plan("visa", 3, 0), plan("visa", 6, 0)], fetchedAt: HACE_1H },
    { proveedor: "mercadopago", medio: "master", planes: [plan("master", 12, 30)], fetchedAt: HACE_1H },
  ];
  programadas = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("leerOfertaCuotas", () => {
  it("arma la oferta con vigencia en hora AR, configVersion y planesFetchedAt", async () => {
    const oferta = await leerOfertaCuotas(deps());
    expect(oferta).not.toBeNull();
    expect(oferta!.hoy).toBe("2026-09-16");
    expect(oferta!.configVersion).toBe(valido.actualizadoEn);
    expect(oferta!.planesFetchedAt).toBe(HACE_1H.toISOString());
    const visa = oferta!.medios.find((m) => m.codigo === "visa")!;
    // valido.json: visa 6 vigente 2026-09-01..2026-09-30 → incluida.
    expect(visa.opciones.map((o) => o.cuotas)).toEqual([3, 6]);
    expect(programadas).toBe(0);
  });

  it("lectura que tira → null sin propagar y registra el error", async () => {
    const oferta = await leerOfertaCuotas(deps({ leerConfig: async () => { throw new Error("db caída"); } }));
    expect(oferta).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("payload de caché ilegible → null", async () => {
    config = { payload: { version: "v9" }, fetchedAt: HACE_1H };
    expect(await leerOfertaCuotas(deps())).toBeNull();
  });

  it("sin config → null y programa sync", async () => {
    config = null;
    expect(await leerOfertaCuotas(deps())).toBeNull();
    expect(programadas).toBe(1);
  });

  it("sin ninguna copia buena de planes → null (legacy) y programa sync", async () => {
    filas = filas.map((f) => ({ ...f, fetchedAt: null, planes: [] }));
    expect(await leerOfertaCuotas(deps())).toBeNull();
    expect(programadas).toBe(1);
  });

  it("copia > 12 h → oferta igual + sync lazy programada", async () => {
    filas[1] = { ...filas[1], fetchedAt: HACE_13H };
    const oferta = await leerOfertaCuotas(deps());
    expect(oferta).not.toBeNull();
    expect(oferta!.planesFetchedAt).toBe(HACE_13H.toISOString());
    expect(programadas).toBe(1);
  });

  it("config > 12 h → programa sync", async () => {
    config = { payload: valido, fetchedAt: HACE_13H };
    await leerOfertaCuotas(deps());
    expect(programadas).toBe(1);
  });

  it("programarSync que tira no rompe la lectura", async () => {
    config = { payload: valido, fetchedAt: HACE_13H };
    const d = deps();
    d.programarSync = () => { throw new Error("after fuera de request"); };
    expect(await leerOfertaCuotas(d)).not.toBeNull();
  });

  it("config vacía válida → oferta leíble sin medios (≠ null)", async () => {
    config = { payload: { ...valido, medios: [], opciones: [] }, fetchedAt: HACE_1H };
    const oferta = await leerOfertaCuotas(deps());
    expect(oferta).toMatchObject({ medios: [] });
  });
});
