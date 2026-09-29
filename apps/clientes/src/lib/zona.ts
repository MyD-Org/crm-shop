/**
 * Zona vigente del visitante (change `sucursales-igz-mdp`, rebanada A). Módulo PURO: recibe la
 * cookie, la provincia del perfil y las reglas como datos; no lee el request ni la DB.
 *
 * Precedencia: cookie `shop_zona` válida > provincia del perfil (`domicilio_provincia`, sólo con
 * usuario logueado) > sucursal predeterminada. Una cookie que no es una provincia conocida se
 * ignora. La zona NUNCA cambia qué productos se ven: sólo decide la sucursal que la atiende.
 */
import { PROVINCIAS_AR } from "./provincias";
import {
  claveProvincia,
  resolverZona,
  type ResolucionZona,
} from "./sucursales";
import type { DatosSucursales, SucursalVista } from "./sucursales-repo";

export const COOKIE_ZONA = "shop_zona";
/** Un año: la zona es una preferencia del visitante, no un dato de sesión. */
export const COOKIE_ZONA_MAX_AGE = 60 * 60 * 24 * 365;

/** Provincias ofrecidas en el selector: `{ clave, nombre }`, en el orden de la lista fija. */
export const PROVINCIAS_SELECTOR = PROVINCIAS_AR.map((nombre) => ({
  clave: claveProvincia(nombre),
  nombre,
}));

/** La clave de una cookie sólo vale si es EXACTAMENTE la clave de una provincia conocida. */
export function claveDeCookie(valor: string | null | undefined): string | null {
  if (!valor) return null;
  return PROVINCIAS_SELECTOR.some((p) => p.clave === valor) ? valor : null;
}

export interface ZonaVigente {
  /** Clave de la provincia elegida (cookie o perfil); null = ninguna (se usa la predeterminada). */
  provinciaClave: string | null;
  origen: "cookie" | "perfil" | "default";
  /** Sucursal que atiende la zona; null si no hay ninguna activa. */
  sucursal: SucursalVista | null;
  resolucion: ResolucionZona | null;
}

export function zonaVigente(entrada: {
  cookie?: string | null;
  perfilProvincia?: string | null;
  datos: DatosSucursales;
}): ZonaVigente {
  const cookie = claveDeCookie(entrada.cookie);
  const perfil = claveProvincia(entrada.perfilProvincia) || null;
  const provinciaClave = cookie ?? perfil;
  const origen = cookie ? "cookie" : perfil ? "perfil" : "default";

  const r = resolverZona(
    provinciaClave,
    entrada.datos.zonas,
    entrada.datos.sucursales,
  );
  if ("error" in r)
    return { provinciaClave, origen, sucursal: null, resolucion: null };
  const sucursal =
    entrada.datos.sucursales.find((s) => s.slug === r.sucursal) ?? null;
  return { provinciaClave, origen, sucursal, resolucion: r };
}

/** Lo que el checkout necesita con el flag `sucursales` prendido. */
export interface OpcionesCheckoutSucursales {
  locales: {
    slug: string;
    nombre: string;
    direccion: string;
    horario: string;
  }[];
  /** Local preseleccionado (retiro): el de la zona si admite retiro, si no la predeterminada. */
  localInicial: string | null;
  /** Provincia preseleccionada (envío): la de la zona vigente (cookie o perfil); null = ninguna. */
  provinciaInicial: string | null;
}

/**
 * Locales de retiro (activos y con retiro) y preselecciones del checkout. Sin ningún local que
 * admita retiro devuelve `locales: []` (el checkout no muestra el selector y el server cae al
 * respaldo de `sucursales-pedido.ts`).
 */
export function opcionesCheckout(
  zona: ZonaVigente,
  datos: DatosSucursales,
): OpcionesCheckoutSucursales {
  const admiten = datos.sucursales
    .filter((s) => s.activa && s.aceptaRetiro)
    .sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug));
  const deLaZona = admiten.find((s) => s.slug === zona.sucursal?.slug);
  const inicial =
    deLaZona ?? admiten.find((s) => s.predeterminada) ?? admiten[0];
  return {
    locales: admiten.map((s) => ({
      slug: s.slug,
      nombre: s.nombre,
      direccion: s.direccion,
      horario: s.horario,
    })),
    localInicial: inicial?.slug ?? null,
    provinciaInicial: zona.provinciaClave,
  };
}
