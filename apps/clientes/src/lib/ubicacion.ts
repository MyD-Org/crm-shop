/**
 * Ubicación del visitante (change `envio-gratis-configurable`, rebanada C). Módulo PURO: sin Next,
 * sin red. Lo importan el server (cookie, páginas) y la UI.
 *
 * Precedencia: dirección guardada (con sesión) → cookie `shop_ubicacion` (geolocalización con
 * permiso o localidad elegida a mano) → sin ubicación. Nunca se inventa una por default ni se usa
 * la IP. No hay código postal: la unidad es la localidad y de ahí sale la provincia.
 */
import { PROVINCIAS_AR } from "./provincias";
import { claveProvincia } from "./sucursales";
import { nombreProvincia, textoEnvioFicha, type ConfigEnvio } from "./envio";

export const COOKIE_UBICACION = "shop_ubicacion";
/** Un año, en segundos. */
export const COOKIE_UBICACION_MAX_AGE = 60 * 60 * 24 * 365;
const MAX_LOCALIDAD = 80;

export interface UbicacionVisitante {
  localidad: string;
  /** Clave canónica de la provincia (`claveProvincia`). */
  provincia: string;
  /** Id de Georef, si la localidad se eligió de la lista. */
  id?: string;
}

export type OrigenUbicacion = "direccion" | "cookie" | "ninguna";

const CLAVES_VALIDAS = new Set(PROVINCIAS_AR.map((p) => claveProvincia(p)));

/** Texto sin caracteres de control ni exceso de largo (la cookie la puede editar cualquiera). */
function limpiar(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  return t && t.length <= MAX_LOCALIDAD ? t : null;
}

/** Arma la ubicación a guardar; null si la localidad o la provincia no sirven. */
export function armarUbicacion(entrada: {
  localidad: unknown;
  provincia: unknown;
  id?: unknown;
}): UbicacionVisitante | null {
  const localidad = limpiar(entrada.localidad);
  const provincia = typeof entrada.provincia === "string" ? entrada.provincia : "";
  if (!localidad || !CLAVES_VALIDAS.has(provincia)) return null;
  const id = typeof entrada.id === "string" && /^\d{1,12}$/.test(entrada.id) ? entrada.id : undefined;
  return id ? { localidad, provincia, id } : { localidad, provincia };
}

/**
 * Valida el valor crudo de la cookie. JSON roto, tipos raros o una provincia fuera del catálogo =
 * null (sin ubicación), sin error.
 */
export function validarCookieUbicacion(raw: string | null | undefined): UbicacionVisitante | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return armarUbicacion({ localidad: o.localidad, provincia: o.provincia, id: o.id });
}

export function serializarCookieUbicacion(u: UbicacionVisitante): string {
  return JSON.stringify(u);
}

/** Dirección guardada → ubicación; null si la ciudad o la provincia no sirven. */
function desdeDireccion(d: { ciudad: string; provincia: string | null } | null | undefined): UbicacionVisitante | null {
  if (!d) return null;
  return armarUbicacion({ localidad: d.ciudad, provincia: claveProvincia(d.provincia) });
}

export function resolverUbicacion(entrada: {
  direccionGuardada?: { ciudad: string; provincia: string | null } | null;
  cookie?: UbicacionVisitante | null;
}): { ubicacion: UbicacionVisitante | null; origen: OrigenUbicacion } {
  const dir = desdeDireccion(entrada.direccionGuardada);
  if (dir) return { ubicacion: dir, origen: "direccion" };
  if (entrada.cookie) return { ubicacion: entrada.cookie, origen: "cookie" };
  return { ubicacion: null, origen: "ninguna" };
}

/** "Estás en <localidad>, <provincia>". */
export function textoUbicacion(u: UbicacionVisitante): string {
  return `Estás en ${u.localidad}, ${nombreProvincia(u.provincia)}`;
}

/**
 * Qué muestra la fila "Envío a domicilio" de la ficha. `pedir` = sólo la localidad decide la
 * respuesta (gratis por provincias) y todavía no se sabe: se invita a ingresarla. Resto: el texto
 * de la regla para su provincia (o la regla general si no hay ubicación). null = envío desactivado.
 */
export function envioFichaSegunUbicacion(
  config: ConfigEnvio,
  ubicacion: UbicacionVisitante | null,
): { tipo: "pedir" } | { tipo: "texto"; texto: string } | null {
  if (!config.domicilioActivo) return null;
  // Sin ubicación no se promete plazo ni costo: se le pide la localidad.
  if (!ubicacion) return { tipo: "pedir" };
  const texto = textoEnvioFicha(config, ubicacion?.provincia, ubicacion?.localidad);
  return texto ? { tipo: "texto", texto } : null;
}

/** Textos de la UI y de los mensajes de error de la API (usted). */
export const TEXTOS_UBICACION = {
  pedir: "Ingrese su localidad",
  pedirEnvio: "Ingrese su localidad para ver plazo y costo",
  cambiar: "Cambiar ubicación",
  usarMiUbicacion: "Usar mi ubicación",
  ubicando: "Buscando su ubicación…",
  titulo: "Ingrese su localidad",
  descripcion: "La usamos para mostrarle las condiciones de envío a su zona.",
  etiquetaInput: "Localidad",
  placeholder: "Escriba al menos 4 letras…",
  buscando: "Buscando…",
  sinResultados: "No encontramos esa localidad. Revise el nombre e inténtelo nuevamente.",
  errorBusqueda: "No pudimos buscar localidades en este momento. Inténtelo nuevamente.",
  errorUbicacion: "No pudimos determinar su ubicación. Ingrese su localidad.",
  sinPermiso: "No pudimos acceder a su ubicación. Ingrese su localidad.",
  invalida: "Ubicación inválida.",
  demasiadas: "Demasiadas consultas. Espere un momento e inténtelo nuevamente.",
  quitar: "Quitar ubicación",
} as const;
