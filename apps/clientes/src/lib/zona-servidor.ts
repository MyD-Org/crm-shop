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
import { disponibilidadSucursalHabilitada } from "./disponibilidad-sucursal-flag";
import { contextoDisponibilidad, type ContextoDisponibilidad } from "./disponibilidad-contexto";
import { reglasVentaCacheadas, sucursalesCacheadas } from "./sucursales-datos";
import {
  COOKIE_ZONA,
  opcionesCheckout,
  zonaVigente,
  type OpcionesCheckoutSucursales,
  type ZonaVigente,
} from "./zona";

export const zonaDelVisitante = cache(async (): Promise<ZonaVigente | null> => {
  if (!(await sucursalesHabilitadas())) return null;
  const datos = await sucursalesCacheadas();
  if (datos.sucursales.length === 0) return null;

  const cookie = (await cookies()).get(COOKIE_ZONA)?.value ?? null;
  let perfilProvincia: string | null = null;
  if (!cookie) {
    try {
      const { clerkUserId } = await identidadActual();
      if (clerkUserId)
        perfilProvincia =
          (await getPerfilFacturacion(clerkUserId))?.domicilioProvincia ?? null;
    } catch (err) {
      console.error("[zona] no se pudo leer la provincia del perfil:", err);
    }
  }
  return zonaVigente({ cookie, perfilProvincia, datos });
});

/** Opciones del checkout (locales de retiro y provincia inicial). null = flag apagado o sin sucursales. */
export async function opcionesCheckoutDelVisitante(): Promise<OpcionesCheckoutSucursales | null> {
  const zona = await zonaDelVisitante();
  if (!zona) return null;
  return opcionesCheckout(zona, await sucursalesCacheadas());
}

/**
 * Contexto de disponibilidad del visitante (flag `disponibilidad-sucursal`): la sucursal de su zona
 * y las reglas de venta. `undefined` = flag apagado (o sin sucursales activas): todo el catálogo
 * usa el stock único de siempre. Se pasa como ARGUMENTO a las lecturas cacheadas
 * (`catalogo-publico.ts`), nunca se lee adentro de un scope cacheado. Si algo falla al leer las
 * reglas, se cae a "sin contexto" (stock único): una falla de configuración no apaga la tienda.
 */
export const dispDelVisitante = cache(async (): Promise<ContextoDisponibilidad | undefined> => {
  if (!(await disponibilidadSucursalHabilitada())) return undefined;
  try {
    const [zona, datos, reglas] = await Promise.all([
      zonaDelVisitante(),
      sucursalesCacheadas(),
      reglasVentaCacheadas(),
    ]);
    return (
      contextoDisponibilidad({
        zona: zona?.sucursal?.slug,
        sucursales: datos.sucursales,
        reglas,
      }) ?? undefined
    );
  } catch (err) {
    console.error("[zona] no se pudo armar el contexto de disponibilidad:", err);
    return undefined;
  }
});
