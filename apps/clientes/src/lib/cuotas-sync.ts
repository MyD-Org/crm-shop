/**
 * Sincronización de cuotas: planes reales del proveedor y config del CRM
 * (contrato v1) a la DB del Shop. SOLO servidor.
 *
 * Reglas (spec cuotas-configurables, dominio 3):
 * - Última copia buena: una fuente que falla o devuelve algo inválido deja su
 *   copia anterior intacta y sólo registra `last_error`.
 * - Fuentes independientes: MP caído no impide actualizar la config, y viceversa.
 * - Vacío válido del CRM se guarda (≠ fallo).
 * - Lock optimista por fila (`last_attempt_at` < 5 min) para cron y lazy. El
 *   ping lo ignora: un cambio del admin tiene que verse en segundos.
 *
 * La persistencia está detrás de `RepoCuotas` (Drizzle en `cuotas-repo.ts`),
 * así la lógica se testea sin DB.
 */
import { parsearContratoCuotasV1 } from "./cuotas-contrato";
import { repoCuotasDrizzle } from "./cuotas-repo";
import { PROVEEDORES_CUOTAS } from "./pagos/proveedores";
import type { ContratoCuotasV1, MedioDePago, PlanDeCuotas } from "./pagos/cuotas-tipos";
import type { ProveedorCuotas } from "./pagos/proveedores/tipos";

export type TriggerSyncCuotas = "cron" | "lazy" | "ping" | "manual";

export const LOCK_MS = 5 * 60 * 1000;
const CRM_TIMEOUT_MS = 10_000;

export interface FilaPlanesLeida {
  proveedor: string;
  medio: string;
  planes: unknown;
  fetchedAt: Date | null;
}

export interface RepoCuotas {
  /** Crea la fila si falta y toma el lock. `vencidoAntesDe` null = forzar. */
  tomarLockConfig(tenant: string, ahora: Date, vencidoAntesDe: Date | null): Promise<boolean>;
  guardarConfig(tenant: string, payload: ContratoCuotasV1, ahora: Date): Promise<void>;
  errorConfig(tenant: string, error: string): Promise<void>;
  leerConfig(tenant: string): Promise<{ payload: unknown; fetchedAt: Date | null } | null>;
  /** Crea las filas que falten y devuelve los medios cuyo lock se tomó. */
  tomarLockPlanes(proveedor: string, medios: string[], ahora: Date, vencidoAntesDe: Date | null): Promise<string[]>;
  guardarPlanes(proveedor: string, medio: string, planes: PlanDeCuotas[], ahora: Date): Promise<void>;
  errorPlanes(proveedor: string, medio: string, error: string): Promise<void>;
  leerPlanes(): Promise<FilaPlanesLeida[]>;
}

export interface DepsSyncCuotas {
  repo: RepoCuotas;
  proveedores: ProveedorCuotas[];
  /** GET crudo del contrato al CRM. Tira ante error de red o status ≠ 200. */
  obtenerConfigCRM: () => Promise<unknown>;
  tenant: string | undefined;
  ahora: () => Date;
}

export type ResultadoSyncConfig =
  | { ok: true; fetchedAt: string; payload: ContratoCuotasV1 }
  | { ok: false; error: string; omitido?: boolean };

export interface ResultadoSyncPlanes {
  ok: boolean;
  medios: { proveedor: string; medio: string; ok: boolean; error?: string }[];
}

export interface ResultadoSyncCuotas {
  ok: boolean;
  config: ResultadoSyncConfig;
  planes: ResultadoSyncPlanes;
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

const usaLock = (trigger: TriggerSyncCuotas) => trigger === "cron" || trigger === "lazy";

function vencimiento(trigger: TriggerSyncCuotas, ahora: Date): Date | null {
  return usaLock(trigger) ? new Date(ahora.getTime() - LOCK_MS) : null;
}

/** Re-pull de la config del CRM. Nunca tira. */
export async function syncConfigCRM(
  trigger: TriggerSyncCuotas,
  deps: DepsSyncCuotas = depsPorDefecto(),
): Promise<ResultadoSyncConfig> {
  const { repo, tenant } = deps;
  if (!tenant) return { ok: false, error: "Falta SHOP_TENANT_ID en el entorno." };

  const ahora = deps.ahora();
  try {
    if (!(await repo.tomarLockConfig(tenant, ahora, vencimiento(trigger, ahora)))) {
      return { ok: false, omitido: true, error: "sync de config en curso" };
    }
  } catch (e) {
    return { ok: false, error: mensaje(e) };
  }

  try {
    const payload = parsearContratoCuotasV1(await deps.obtenerConfigCRM());
    if (payload.tenant !== tenant) {
      throw new Error(`el CRM devolvió el tenant "${payload.tenant}" en vez de "${tenant}"`);
    }
    await repo.guardarConfig(tenant, payload, ahora);
    return { ok: true, fetchedAt: ahora.toISOString(), payload };
  } catch (e) {
    const error = mensaje(e);
    console.error(`[cuotas-sync] config CRM (${trigger}) falló:`, error);
    await repo.errorConfig(tenant, error).catch(() => {});
    return { ok: false, error };
  }
}

/**
 * Planes de cada proveedor para los medios activos de la config. Sin config
 * (nunca se leyó el CRM) se consultan los medios por defecto del proveedor.
 * Nunca tira.
 */
export async function syncPlanesProveedor(
  trigger: TriggerSyncCuotas,
  deps: DepsSyncCuotas = depsPorDefecto(),
  mediosConfig: MedioDePago[] | null = null,
): Promise<ResultadoSyncPlanes> {
  const { repo } = deps;
  const ahora = deps.ahora();
  const salida: ResultadoSyncPlanes["medios"] = [];

  for (const proveedor of deps.proveedores) {
    const medios = mediosConfig
      ? [...new Set(mediosConfig.filter((m) => m.activo && m.proveedor === proveedor.id).map((m) => m.codigo))]
      : proveedor.mediosPorDefecto;
    if (medios.length === 0) continue;

    let tomados: string[];
    try {
      tomados = await repo.tomarLockPlanes(proveedor.id, medios, ahora, vencimiento(trigger, ahora));
    } catch (e) {
      salida.push(...medios.map((medio) => ({ proveedor: proveedor.id, medio, ok: false, error: mensaje(e) })));
      continue;
    }
    if (tomados.length === 0) continue;

    let resultados;
    try {
      resultados = await proveedor.obtenerPlanesPorMedio(tomados);
    } catch (e) {
      resultados = tomados.map((medio) => ({ medio, ok: false as const, error: mensaje(e) }));
    }

    for (const r of resultados) {
      try {
        if (r.ok) await repo.guardarPlanes(proveedor.id, r.medio, r.planes, ahora);
        else {
          console.error(`[cuotas-sync] planes ${proveedor.id}/${r.medio} (${trigger}) falló:`, r.error);
          await repo.errorPlanes(proveedor.id, r.medio, r.error);
        }
        salida.push({ proveedor: proveedor.id, medio: r.medio, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
      } catch (e) {
        salida.push({ proveedor: proveedor.id, medio: r.medio, ok: false, error: mensaje(e) });
      }
    }
  }

  return { ok: salida.every((m) => m.ok), medios: salida };
}

/** Config de la caché (si es legible) cuando el pull de esta corrida falló. */
async function configVigente(deps: DepsSyncCuotas, config: ResultadoSyncConfig): Promise<ContratoCuotasV1 | null> {
  if (config.ok) return config.payload;
  if (!deps.tenant) return null;
  try {
    const fila = await deps.repo.leerConfig(deps.tenant);
    return fila?.payload ? parsearContratoCuotasV1(fila.payload) : null;
  } catch {
    return null;
  }
}

/** Aviso operativo: el admin marcó sin interés pero la cuenta del proveedor cobra tasa. */
async function advertirSinInteresConTasa(deps: DepsSyncCuotas, config: ContratoCuotasV1 | null) {
  if (!config) return;
  let filas: FilaPlanesLeida[];
  try {
    filas = await deps.repo.leerPlanes();
  } catch {
    return;
  }
  for (const o of config.opciones) {
    if (!o.activo || !o.sinInteres) continue;
    const medio = config.medios.find((m) => m.id === o.medioId);
    if (!medio) continue;
    const fila = filas.find((f) => f.proveedor === medio.proveedor && f.medio === medio.codigo);
    const planes = Array.isArray(fila?.planes) ? (fila.planes as PlanDeCuotas[]) : [];
    const p = planes.find((x) => x?.cuotas === o.cuotas);
    if (p && typeof p.tasaPct === "number" && p.tasaPct > 0) {
      console.warn(
        `[cuotas-sync] ${medio.codigo} ${o.cuotas} cuotas está marcada sin interés en el CRM pero la tasa del proveedor es ${p.tasaPct}%: se mostrará con interés.`,
      );
    }
  }
}

/** Corrida completa: config primero (define qué medios consultar), después planes. */
export async function syncCuotas(
  trigger: TriggerSyncCuotas,
  deps: DepsSyncCuotas = depsPorDefecto(),
): Promise<ResultadoSyncCuotas> {
  const config = await syncConfigCRM(trigger, deps);
  const vigente = await configVigente(deps, config);
  const planes = await syncPlanesProveedor(trigger, deps, vigente ? vigente.medios : null);
  await advertirSinInteresConTasa(deps, vigente);
  return { ok: config.ok && planes.ok, config, planes };
}

// ---------------------------------------------------------------------------
// Dependencias reales
// ---------------------------------------------------------------------------

/** GET {CRM_INTERNAL_URL}/api/internal/shop/cuotas?tenant=… con Bearer INTERNAL_SECRET. */
export async function obtenerConfigCRMHttp(): Promise<unknown> {
  const base = process.env.CRM_INTERNAL_URL;
  const secreto = process.env.INTERNAL_SECRET;
  const tenant = process.env.SHOP_TENANT_ID;
  if (!base || !secreto || !tenant) {
    throw new Error("Faltan CRM_INTERNAL_URL, INTERNAL_SECRET o SHOP_TENANT_ID en el entorno.");
  }
  const url = `${base.replace(/\/+$/, "")}/api/internal/shop/cuotas?tenant=${encodeURIComponent(tenant)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secreto}` },
    signal: AbortSignal.timeout(CRM_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CRM respondió HTTP ${res.status}`);
  return res.json();
}

function depsPorDefecto(): DepsSyncCuotas {
  return {
    repo: repoCuotasDrizzle,
    proveedores: PROVEEDORES_CUOTAS,
    obtenerConfigCRM: obtenerConfigCRMHttp,
    tenant: process.env.SHOP_TENANT_ID,
    ahora: () => new Date(),
  };
}
