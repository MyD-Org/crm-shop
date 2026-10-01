/**
 * Lectura de la ubicación del visitante en el server. Lee el request (cookie e identidad), así que
 * va SIEMPRE fuera de los scopes cacheados y dentro de un hueco por request (Suspense).
 *
 * Precedencia (ver `resolverUbicacion`): dirección guardada con sesión → cookie `shop_ubicacion` →
 * sin ubicación. Una falla al leer las direcciones no rompe nada: se sigue con la cookie.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { identidadActual } from "./auth";
import { listarDirecciones } from "./direcciones-envio-db";
import {
  COOKIE_UBICACION,
  resolverUbicacion,
  validarCookieUbicacion,
  type OrigenUbicacion,
  type UbicacionVisitante,
} from "./ubicacion";

export const ubicacionDelVisitante = cache(
  async (): Promise<{ ubicacion: UbicacionVisitante | null; origen: OrigenUbicacion }> => {
    const cookie = validarCookieUbicacion((await cookies()).get(COOKIE_UBICACION)?.value);
    let direccionGuardada: { ciudad: string; provincia: string | null } | null = null;
    try {
      const { clerkUserId } = await identidadActual();
      if (clerkUserId) {
        const direcciones = await listarDirecciones(clerkUserId);
        const d = direcciones.find((x) => x.predeterminada) ?? direcciones[0];
        if (d) direccionGuardada = { ciudad: d.ciudad, provincia: d.provincia };
      }
    } catch (err) {
      console.error("[ubicacion] no se pudieron leer las direcciones guardadas:", err);
    }
    return resolverUbicacion({ direccionGuardada, cookie });
  },
);
