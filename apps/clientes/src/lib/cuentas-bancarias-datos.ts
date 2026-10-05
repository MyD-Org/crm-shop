/**
 * Cuentas bancarias del CRM para MOSTRAR (vista previa en el checkout). SOLO servidor.
 *
 * `'use cache: remote'` con el tag `sucursales` y el perfil `sucursales` (5 minutos): al guardar una
 * cuenta en el admin del CRM, el ping de `/api/internal/sucursales/revalidar` la vence al instante.
 * La resolución que escribe un pedido NO usa esto: relee sin caché (`leerCuentasBancariasEnTx`).
 * Falla (tabla ausente, permiso) = `[]` con el perfil `degradado`. Si falla la caché misma, se lee
 * sin caché (`conRespaldoSinCache`).
 */
import { cacheLife, cacheTag } from "next/cache";
import { conRespaldoSinCache } from "./cache-respaldo";
import { TAG_SUCURSALES } from "./cache-tags";
import { leerCuentasBancarias } from "./cuentas-bancarias-repo";
import type { CuentaBancaria } from "./cuentas-bancarias";

export function cuentasBancariasCacheadas(): Promise<CuentaBancaria[]> {
  return conRespaldoSinCache("cuentas-bancarias", cuentasDeCache, () => leerCuentasBancarias().catch(() => []));
}

async function cuentasDeCache(): Promise<CuentaBancaria[]> {
  "use cache: remote";
  cacheTag(TAG_SUCURSALES);
  try {
    const cuentas = await leerCuentasBancarias();
    cacheLife("sucursales");
    return cuentas;
  } catch (err) {
    console.warn(
      "[cuentas-bancarias-datos] no se pudieron leer las cuentas del CRM:",
      err instanceof Error ? err.message : err,
    );
    cacheLife("degradado");
    return [];
  }
}
