/**
 * Lectura de la zona del visitante en el server. Lee el request (cookie e identidad), así que va
 * SIEMPRE fuera de los scopes cacheados y dentro de un hueco por request. Con el flag `sucursales`
 * apagado devuelve null: nada de zona.
 */
import { cache } from "react";
import { identidadActual } from "./auth";
import { ubicacionDelVisitante } from "./ubicacion-servidor";
import { getPerfilFacturacion } from "./facturacion-db";
import { sucursalesHabilitadas } from "./sucursales-flag";
import { disponibilidadSucursalHabilitada } from "./disponibilidad-sucursal-flag";
import {
  contextoDisponibilidad,
  contextoUnion,
  type ContextoDisponibilidad,
} from "./disponibilidad-contexto";
import { reglasVentaCacheadas, sucursalesCacheadas } from "./sucursales-datos";
import {
  aplicarRetiro,
  opcionesCheckout,
  zonaVigente,
  type OpcionesCheckoutSucursales,
  type ZonaVigente,
} from "./zona";

export const zonaDelVisitante = cache(async (): Promise<ZonaVigente | null> => {
  if (!(await sucursalesHabilitadas())) return null;
  const datos = await sucursalesCacheadas();
  if (datos.sucursales.length === 0) return null;

  // La cookie `shop_zona` del selector de zona viejo (sacado en #279) ya no se lee: muchos
  // navegadores la conservan y pisaba la ubicación. La zona sale de la ubicación del visitante (la
  // que eligió a mano o su dirección guardada) y, si no hay, de la provincia del perfil.
  const { ubicacion, eleccion } = await ubicacionDelVisitante();
  // Retiro elegido: la sucursal elegida manda sobre la de la provincia (por request; el catálogo
  // cacheado no se entera: `dispCatalogo` no lee la elección).
  const retiro = eleccion.tipo === "retiro" ? (eleccion.sucursal?.slug ?? null) : null;
  if (ubicacion) return aplicarRetiro(zonaVigente({ perfilProvincia: ubicacion.provincia, datos }), retiro, datos);
  let perfilProvincia: string | null = null;
  try {
    const { clerkUserId } = await identidadActual();
    if (clerkUserId)
      perfilProvincia =
        (await getPerfilFacturacion(clerkUserId))?.domicilioProvincia ?? null;
  } catch (err) {
    console.error("[zona] no se pudo leer la provincia del perfil:", err);
  }
  return aplicarRetiro(zonaVigente({ perfilProvincia, datos }), retiro, datos);
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

/**
 * Contexto de disponibilidad del CATÁLOGO (listado, facetas, ficha, relacionados, menú, home,
 * búsquedas del chat). No depende del visitante: "hay stock" = stock en CUALQUIER local activo y
 * se muestra todo lo que alguna sucursal ofrece. La zona recién importa en la entrega (carrito y
 * checkout, `dispDelVisitante`). Como no lee cookie, IP ni identidad, la clave de la caché del
 * catálogo es la misma para todos.
 *
 * `undefined` = flag `disponibilidad-sucursal` apagado (o sin sucursales): stock único de siempre.
 */
export const dispCatalogo = cache(async (): Promise<ContextoDisponibilidad | undefined> => {
  if (!(await disponibilidadSucursalHabilitada())) return undefined;
  try {
    const [datos, reglas] = await Promise.all([sucursalesCacheadas(), reglasVentaCacheadas()]);
    const base = contextoDisponibilidad({ zona: null, sucursales: datos.sucursales, reglas });
    return base ? contextoUnion(base) : undefined;
  } catch (err) {
    console.error("[zona] no se pudo armar el contexto del catálogo:", err);
    return undefined;
  }
});

/** Locales que se ofrecen en el filtro "Con stock en": activos y que aceptan retiro, por `orden`. */
export async function localesDeRetiro(): Promise<{ slug: string; nombre: string }[]> {
  if (!(await disponibilidadSucursalHabilitada())) return [];
  try {
    const datos = await sucursalesCacheadas();
    return datos.sucursales
      .filter((s) => s.activa && s.aceptaRetiro)
      .sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug))
      .map((s) => ({ slug: s.slug, nombre: s.nombre }));
  } catch (err) {
    console.error("[zona] no se pudieron leer los locales de retiro:", err);
    return [];
  }
}

/**
 * Contexto del filtro "Con stock en <local>": sólo cuenta el stock de ese local y excluye lo que
 * el local tiene oculto. `undefined` si el flag está apagado o el slug no es un local activo con
 * retiro (la page lo descarta y usa `dispCatalogo`).
 */
export async function dispConStockEn(slug: string): Promise<ContextoDisponibilidad | undefined> {
  if (!(await disponibilidadSucursalHabilitada())) return undefined;
  try {
    const [datos, reglas] = await Promise.all([sucursalesCacheadas(), reglasVentaCacheadas()]);
    const local = datos.sucursales.find((s) => s.slug === slug && s.activa && s.aceptaRetiro);
    if (!local) return undefined;
    return (
      contextoDisponibilidad({
        zona: null,
        sucursales: datos.sucursales,
        reglas,
        modalidad: "retiro",
        local: slug,
      }) ?? undefined
    );
  } catch (err) {
    console.error("[zona] no se pudo armar el contexto del filtro por local:", err);
    return undefined;
  }
}
