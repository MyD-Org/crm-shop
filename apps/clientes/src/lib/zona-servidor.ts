/**
 * Lectura de la zona del visitante en el server. Lee el request (cookie e identidad), así que va
 * SIEMPRE fuera de los scopes cacheados y dentro de un hueco por request. Con el flag `sucursales`
 * apagado devuelve null: nada de zona.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { identidadActual } from "./auth";
import { getPerfilFacturacion } from "./facturacion-db";
import { sucursalesHabilitadas } from "./sucursales-flag";
import { sucursalesCacheadas } from "./sucursales-datos";
import { COOKIE_ZONA, zonaVigente, type ZonaVigente } from "./zona";

export const zonaDelVisitante = cache(async (): Promise<ZonaVigente | null> => {
  if (!(await sucursalesHabilitadas())) return null;
  const datos = await sucursalesCacheadas();
  if (datos.sucursales.length === 0) return null;

  const cookie = (await cookies()).get(COOKIE_ZONA)?.value ?? null;
  let perfilProvincia: string | null = null;
  if (!cookie) {
    try {
      const { clerkUserId } = await identidadActual();
      if (clerkUserId) perfilProvincia = (await getPerfilFacturacion(clerkUserId))?.domicilioProvincia ?? null;
    } catch (err) {
      console.error("[zona] no se pudo leer la provincia del perfil:", err);
    }
  }
  return zonaVigente({ cookie, perfilProvincia, datos });
});
