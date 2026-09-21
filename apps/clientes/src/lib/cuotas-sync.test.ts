import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import valido from "./__fixtures__/cuotas-contrato-v2/valido.json";
import vacioValido from "./__fixtures__/cuotas-contrato-v2/vacio-valido.json";
import type { PlanDeCuotas } from "./pagos/cuotas-tipos";
import type { ProveedorCuotas, ResultadoPlanesMedio } from "./pagos/proveedores/tipos";
import {
  LOCK_MS,
  syncConfigCRM,
  syncCuotas,
  syncPlanesProveedor,
  type DepsSyncCuotas,
  type RepoCuotas,
} from "./cuotas-sync";

/**
 * La sync se testea contra un repo en memoria que respeta la semántica del
 * repo de Drizzle (lock condicional por `last_attempt_at`, upsert de filas).
 * Lo que importa: última copia buena intacta ante fallos, fuentes
 * independientes, vacío válido se guarda, lock evita doble corrida.
 */

interface FilaConfig { payload: unknown; version: string | null; fetchedAt: Date | null; lastAttemptAt: Date | null; lastError: string | null }
interface FilaPlanes { planes: PlanDeCuotas[]; fetchedAt: Date | null; lastAttemptAt: Date | null; lastError: string | null }

function repoEnMemoria() {
  const config = new Map<string, FilaConfig>();
  const planes = new Map<string, FilaPlanes>();
  const clave = (p: string, m: string) => `${p}|${m}`;
  const libre = (f: { lastAttemptAt: Date | null }, antes: Date | null) =>
    antes === null || f.lastAttemptAt === null || f.lastAttemptAt < antes;

  const repo: RepoCuotas = {
    async tomarLockConfig(tenant, ahora, antes) {
      const f = config.get(tenant) ?? { payload: null, version: null, fetchedAt: null, lastAttemptAt: null, lastError: null };
      config.set(tenant, f);
      if (!libre(f, antes)) return false;
      f.lastAttemptAt = ahora;
      return true;
    },
    async guardarConfig(tenant, payload, ahora) {
      Object.assign(config.get(tenant)!, { payload, version: payload.version, fetchedAt: ahora, lastError: null });
    },
    async errorConfig(tenant, error) {
      config.get(tenant)!.lastError = error;
    },
    async leerConfig(tenant) {
      const f = config.get(tenant);
      return f ? { payload: f.payload, fetchedAt: f.fetchedAt } : null;
    },
    async tomarLockPlanes(proveedor, medios, ahora, antes) {
      const tomados: string[] = [];
      for (const m of medios) {
        const f = planes.get(clave(proveedor, m)) ?? { planes: [], fetchedAt: null, lastAttemptAt: null, lastError: null };
        planes.set(clave(proveedor, m), f);
        if (libre(f, antes)) {
          f.lastAttemptAt = ahora;
          tomados.push(m);
        }
      }
      return tomados;
    },
    async guardarPlanes(proveedor, medio, ps, ahora) {
      Object.assign(planes.get(clave(proveedor, medio))!, { planes: ps, fetchedAt: ahora, lastError: null });
    },
    async errorPlanes(proveedor, medio, error) {
      planes.get(clave(proveedor, medio))!.lastError = error;
    },
    async leerPlanes() {
      return [...planes.entries()].map(([k, f]) => {
        const [proveedor, medio] = k.split("|");
        return { proveedor, medio, planes: f.planes, fetchedAt: f.fetchedAt };
      });
    },
  };
  return { repo, config, planes };
}

const plan = (medio: string, cuotas: number, tasaPct: number): PlanDeCuotas => ({
  proveedor: "mercadopago", medio, cuotas, tasaPct, cftPct: null, teaPct: null, montoMin: null, montoMax: null,
});

function proveedorFalso(respuesta: (medio: string) => ResultadoPlanesMedio): ProveedorCuotas & { consultados: string[][] } {
  const consultados: string[][] = [];
  return {
    id: "mercadopago",
    mediosPorDefecto: ["visa", "master"],
    consultados,
    async obtenerPlanesPorMedio(medios) {
      consultados.push(medios);
      return medios.map(respuesta);
    },
    async obtenerPlanes() {
      throw new Error("no usado");
    },
  };
}

const T0 = new Date("2026-09-16T12:00:00Z");
const DESPUES = new Date(T0.getTime() + LOCK_MS + 1000);

let mem: ReturnType<typeof repoEnMemoria>;
let reloj: Date;
let crm: () => Promise<unknown>;
let mp: ReturnType<typeof proveedorFalso>;

const deps = (): DepsSyncCuotas => ({
  repo: mem.repo,
  proveedores: [mp],
  obtenerConfigCRM: () => crm(),
  tenant: "central-led",
  ahora: () => reloj,
});

const okMP = (medio: string): ResultadoPlanesMedio => ({ medio, ok: true, planes: [plan(medio, 3, 0), plan(medio, 6, 0), plan(medio, 12, 20)] });

beforeEach(() => {
  mem = repoEnMemoria();
  reloj = T0;
  crm = async () => valido;
  mp = proveedorFalso(okMP);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("syncCuotas", () => {
  it("éxito: guarda config y snapshots con fetchedAt", async () => {
    const r = await syncCuotas("cron", deps());
    expect(r.ok).toBe(true);
    expect(mem.config.get("central-led")).toMatchObject({ payload: valido, version: "v2", fetchedAt: T0, lastError: null });
    expect(mem.planes.get("mercadopago|visa")).toMatchObject({ fetchedAt: T0, lastError: null });
    expect(mem.planes.get("mercadopago|visa")!.planes).toHaveLength(3);
    // Mercado Pago está activo en la config: consulta sus marcas de crédito.
    expect(mp.consultados[0].sort()).toEqual(["master", "visa"]);
  });

  it("MP caído + CRM ok: planes y fetchedAt viejos intactos, lastError seteado, config actualizada", async () => {
    await syncCuotas("cron", deps());
    const planesViejos = mem.planes.get("mercadopago|visa")!.planes;

    reloj = DESPUES;
    mp = proveedorFalso((medio) => ({ medio, ok: false, error: "HTTP 500" }));
    const r = await syncCuotas("cron", deps());

    expect(r.ok).toBe(false);
    const visa = mem.planes.get("mercadopago|visa")!;
    expect(visa.planes).toBe(planesViejos);
    expect(visa.fetchedAt).toEqual(T0);
    expect(visa.lastError).toMatch(/500/);
    expect(mem.config.get("central-led")!.fetchedAt).toEqual(DESPUES);
  });

  it("adaptador que tira: no pisa planes y marca error en cada medio", async () => {
    await syncCuotas("cron", deps());
    reloj = DESPUES;
    mp.obtenerPlanesPorMedio = async () => { throw new Error("boom"); };
    await syncCuotas("cron", deps());
    expect(mem.planes.get("mercadopago|master")).toMatchObject({ fetchedAt: T0, lastError: "boom" });
    expect(mem.planes.get("mercadopago|master")!.planes).toHaveLength(3);
  });

  it("fallo parcial: sólo el medio caído queda con error", async () => {
    mp = proveedorFalso((medio) => (medio === "master" ? { medio, ok: false, error: "timeout" } : okMP(medio)));
    await syncCuotas("cron", deps());
    expect(mem.planes.get("mercadopago|visa")).toMatchObject({ fetchedAt: T0, lastError: null });
    expect(mem.planes.get("mercadopago|master")).toMatchObject({ fetchedAt: null, lastError: "timeout" });
  });

  it("CRM inválido: payload intacto + lastError; los planes igual se sincronizan", async () => {
    await syncCuotas("cron", deps());
    reloj = DESPUES;
    crm = async () => ({ ...valido, version: "v1" });
    const r = await syncCuotas("cron", deps());

    expect(r.config.ok).toBe(false);
    expect(mem.config.get("central-led")).toMatchObject({ payload: valido, fetchedAt: T0 });
    expect(mem.config.get("central-led")!.lastError).toMatch(/version/);
    expect(mem.planes.get("mercadopago|visa")!.fetchedAt).toEqual(DESPUES);
  });

  it("CRM de otro tenant → inválido", async () => {
    crm = async () => ({ ...valido, tenant: "otro" });
    const r = await syncConfigCRM("cron", deps());
    expect(r.ok).toBe(false);
    expect(mem.config.get("central-led")!.payload).toBeNull();
  });

  it("CRM caído sin copia previa: consulta las marcas de todos los proveedores", async () => {
    crm = async () => { throw new Error("ECONNREFUSED"); };
    await syncCuotas("cron", deps());
    expect(mp.consultados[0].sort()).toEqual(["master", "visa"]);
    expect(mem.config.get("central-led")).toMatchObject({ payload: null, lastError: "ECONNREFUSED" });
  });

  it("CRM vacío válido: se guarda y no consulta planes (no hay proveedores)", async () => {
    await syncCuotas("cron", deps());
    reloj = DESPUES;
    crm = async () => vacioValido;
    const r = await syncCuotas("cron", deps());
    expect(r.config.ok).toBe(true);
    expect(mem.config.get("central-led")).toMatchObject({ payload: vacioValido, fetchedAt: DESPUES });
    expect(mp.consultados).toHaveLength(1);
  });

  it("lock optimista: una segunda corrida lazy dentro de 5 min no vuelve a consultar", async () => {
    await syncCuotas("cron", deps());
    let llamadasCRM = 0;
    crm = async () => { llamadasCRM++; return valido; };
    reloj = new Date(T0.getTime() + 60_000);
    const r = await syncCuotas("lazy", deps());

    expect(llamadasCRM).toBe(0);
    expect(mp.consultados).toHaveLength(1);
    expect(r.config).toMatchObject({ ok: false, omitido: true });
  });

  it("el ping ignora el lock (el cambio del admin se ve en segundos)", async () => {
    await syncCuotas("cron", deps());
    reloj = new Date(T0.getTime() + 60_000);
    crm = async () => vacioValido;
    const r = await syncConfigCRM("ping", deps());
    expect(r.ok).toBe(true);
    expect(mem.config.get("central-led")!.payload).toEqual(vacioValido);
  });

  it("sin SHOP_TENANT_ID: error sin tocar el repo", async () => {
    const r = await syncConfigCRM("cron", { ...deps(), tenant: undefined });
    expect(r).toMatchObject({ ok: false });
    expect(mem.config.size).toBe(0);
  });
});

describe("syncPlanesProveedor", () => {
  const prov = (proveedor: string, activo = true) => ({
    id: proveedor, proveedor, nombre: proveedor, activo, orden: 0, escalones: [],
  });

  it("consulta visa y master del proveedor activo; inactivos o sin adaptador no se consultan", async () => {
    await syncPlanesProveedor("cron", deps(), [prov("mercadopago"), prov("mobbex")]);
    expect(mp.consultados).toEqual([["visa", "master"]]);
  });

  it("proveedor inactivo en la config → no se consulta", async () => {
    await syncPlanesProveedor("cron", deps(), [prov("mercadopago", false)]);
    expect(mp.consultados).toEqual([]);
  });
});
