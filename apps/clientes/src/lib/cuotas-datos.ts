/**
 * Lectura de la oferta de cuotas desde la DB del Shop. SOLO servidor.
 *
 * - `getOfertaCuotas()`: para exhibir. null si el flag está apagado, si no hay
 *   datos o si algo falla (se registra y la página sigue sin cuotas).
 * - `getOfertaCuotasParaPedido()`: SIN gate de flag, para congelar el plan en
 *   el pedido aunque el flag esté apagado (D11/D13). null = sin oferta leíble →
 *   el pedido queda con cuotas_max null (legacy 1..24).
 *
 * Si la copia de config o de planes tiene > 12 h (o no existe), programa una
 * sync lazy con `after()` para no depender sólo del cron.
 */
import { after } from "next/server";
import { cache } from "react";
import { armarOferta } from "./cuotas";
import { parsearContratoCuotasV2 } from "./cuotas-contrato";
import { cuotasHabilitadas } from "./cuotas-flag";
import { repoCuotasDrizzle } from "./cuotas-repo";
import { syncCuotas, type RepoCuotas } from "./cuotas-sync";
import type { OfertaCuotas, PlanDeCuotas } from "./pagos/cuotas-tipos";

export const VIEJO_MS = 12 * 60 * 60 * 1000;

export interface DepsOfertaCuotas {
  repo: Pick<RepoCuotas, "leerConfig" | "leerPlanes">;
  tenant: string | undefined;
  ahora: () => Date;
  programarSync: () => void;
}

export async function leerOfertaCuotas(deps: DepsOfertaCuotas): Promise<OfertaCuotas | null> {
  const ahora = deps.ahora();
  let refrescar = false;
  const programar = () => {
    try {
      deps.programarSync();
    } catch (e) {
      console.error("[cuotas-datos] no se pudo programar la sync lazy:", e);
    }
  };
  const viejo = (f: Date | null) => f === null || ahora.getTime() - new Date(f).getTime() > VIEJO_MS;

  try {
    if (!deps.tenant) return null;
    const config = await deps.repo.leerConfig(deps.tenant);
    if (!config?.payload) {
      programar();
      return null;
    }
    if (viejo(config.fetchedAt)) refrescar = true;
    let payload;
    try {
      payload = parsearContratoCuotasV2(config.payload);
    } catch (e) {
      // Caché de otra versión (p. ej. v1 guardada antes del deploy) o corrupta:
      // sin cuotas hasta que una sync traiga una copia buena.
      programar();
      throw e;
    }

    const relevantes = new Set(payload.proveedores.filter((p) => p.activo).map((p) => p.proveedor));
    const filas = (await deps.repo.leerPlanes()).filter((f) => relevantes.has(f.proveedor));
    const buenas = filas.filter((f) => f.fetchedAt !== null && Array.isArray(f.planes));

    if (relevantes.size > 0 && buenas.length === 0) {
      programar();
      return null;
    }
    // Una marca sin copia buena (fetchedAt null) o vieja → refrescar.
    if (filas.some((f) => viejo(f.fetchedAt))) refrescar = true;

    const planes = buenas.flatMap((f) => f.planes as PlanDeCuotas[]);
    const oferta = armarOferta(payload.proveedores, planes);
    const masVieja = buenas
      .map((f) => new Date(f.fetchedAt!))
      .sort((a, b) => a.getTime() - b.getTime())[0];

    if (refrescar) programar();
    return {
      ...oferta,
      configVersion: payload.actualizadoEn,
      planesFetchedAt: masVieja ? masVieja.toISOString() : null,
    };
  } catch (e) {
    console.error("[cuotas-datos] no se pudo leer la oferta de cuotas:", e);
    return null;
  }
}

function depsPorDefecto(): DepsOfertaCuotas {
  return {
    repo: repoCuotasDrizzle,
    tenant: process.env.SHOP_TENANT_ID,
    ahora: () => new Date(),
    programarSync: () =>
      after(async () => {
        const r = await syncCuotas("lazy");
        if (!r.ok) console.warn("[cuotas-datos] sync lazy incompleta:", JSON.stringify(r));
      }),
  };
}

/** Oferta para el pedido: sin gate de flag. Deduplicada por request. */
export const getOfertaCuotasParaPedido = cache(
  async (): Promise<OfertaCuotas | null> => leerOfertaCuotas(depsPorDefecto()),
);

/** Oferta para exhibir: null con el flag apagado. Deduplicada por request. */
export const getOfertaCuotas = cache(async (): Promise<OfertaCuotas | null> => {
  if (!cuotasHabilitadas()) return null;
  return getOfertaCuotasParaPedido();
});
