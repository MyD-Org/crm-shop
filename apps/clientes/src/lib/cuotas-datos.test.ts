import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import valido from "./__fixtures__/cuotas-contrato-v2/valido.json";
import { leerOfertaCuotas, type DepsOfertaCuotas } from "./cuotas-datos";
import type { FilaPlanesLeida, RepoCuotas } from "./cuotas-sync";
import type { PlanDeCuotas } from "./pagos/cuotas-tipos";

const AHORA = new Date("2026-09-17T15:00:00Z");
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
  it("arma la oferta por proveedor juntando marcas, con configVersion y planesFetchedAt", async () => {
    const oferta = await leerOfertaCuotas(deps());
    expect(oferta).not.toBeNull();
    expect(oferta!.configVersion).toBe(valido.actualizadoEn);
    expect(oferta!.planesFetchedAt).toBe(HACE_1H.toISOString());
    const mp = oferta!.proveedores.find((p) => p.proveedor === "mercadopago")!;
    expect(mp.nombre).toBe("Mercado Pago");
    expect(mp.escalones).toEqual([
      { cuotasMax: 3, montoMinimo: 0 },
      { cuotasMax: 6, montoMinimo: 180000 },
      { cuotasMax: 12, montoMinimo: 450000.5 },
    ]);
    // visa 3, 6 (0%) + master 12 (30%) → una sola lista.
    expect(mp.opciones.map((o) => [o.cuotas, o.sinInteres])).toEqual([[3, true], [6, true], [12, false]]);
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

  it("caché con contrato v1 (deploy antes que el CRM) → null y programa sync", async () => {
    config = { payload: { version: "v1", tenant: "central-led", actualizadoEn: "2026-09-16T20:00:00.000Z", medios: [], opciones: [] }, fetchedAt: HACE_1H };
    expect(await leerOfertaCuotas(deps())).toBeNull();
    expect(programadas).toBe(1);
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

  it("planes de proveedores no configurados no cuentan como copia buena", async () => {
    filas = [{ proveedor: "otro", medio: "visa", planes: [plan("visa", 3, 0)], fetchedAt: HACE_1H }];
    expect(await leerOfertaCuotas(deps())).toBeNull();
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

  it("config vacía válida → oferta leíble sin proveedores (≠ null)", async () => {
    config = { payload: { ...valido, proveedores: [] }, fetchedAt: HACE_1H };
    const oferta = await leerOfertaCuotas(deps());
    expect(oferta).toMatchObject({ proveedores: [] });
  });
});
