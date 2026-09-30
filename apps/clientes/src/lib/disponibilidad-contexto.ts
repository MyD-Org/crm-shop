/**
 * Contexto de disponibilidad por sucursal para las lecturas del catálogo (flag
 * `disponibilidad-sucursal`). PURO y serializable: viaja como ARGUMENTO a las funciones
 * `'use cache'` de `catalogo-publico.ts`, así la sucursal de la zona (y sus reglas) es parte de la
 * clave de la caché y nunca se lee la cookie dentro del scope cacheado.
 *
 * Con el flag apagado, o sin sucursales cargadas, no hay contexto (`undefined`) y las lecturas usan
 * el stock único de siempre.
 */
import {
  permiteRespaldo,
  type ReglasVenta,
  type SucursalDato,
} from "./sucursales";

export interface ContextoDisponibilidad {
  /** Slug de la sucursal de la zona vigente del visitante. */
  zona: string;
  /** Slugs de las sucursales activas, por `orden`. */
  activas: string[];
  /**
   * Sucursales cuyo stock cuenta para "hay stock" (badge y filtro "con stock"): en modalidad envío,
   * la unión de las activas (o sólo la de la zona si `respaldo_envio` está apagado); en retiro, sólo
   * el local elegido.
   */
  contarEn: string[];
  /**
   * Sucursal que recibe el stock de la vista del CRM cuando un producto todavía no tiene filas por
   * sucursal (transición hasta la primera sync por sucursal): la primera activa por `orden`.
   */
  stockHeredado: string;
  /** Local de retiro elegido; sólo en modalidad retiro. */
  local?: string;
}

/**
 * El mismo contexto pero contando el stock de TODAS las sucursales activas y sin local: es el que usa
 * la cotización del carrito. Es permisivo a propósito (deja pasar lo que alguna sucursal puede
 * servir): la decisión definitiva por modalidad (retiro en un local, envío con o sin respaldo) la
 * toma `asignarSucursal` al crear el pedido.
 */
export function contextoUnion(
  ctx: ContextoDisponibilidad,
): ContextoDisponibilidad {
  return {
    zona: ctx.zona,
    activas: ctx.activas,
    contarEn: ctx.activas,
    stockHeredado: ctx.stockHeredado,
  };
}

const ordenadas = (sucursales: SucursalDato[]) =>
  sucursales
    .filter((s) => s.activa)
    .sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug));

/**
 * Arma el contexto. `null` si no hay ninguna sucursal activa (las lecturas caen al stock único).
 * `zona` inexistente o inactiva cae en la predeterminada y, si no, en la primera activa.
 */
export function contextoDisponibilidad(entrada: {
  zona: string | null | undefined;
  sucursales: SucursalDato[];
  reglas?: ReglasVenta;
  modalidad?: "envio" | "retiro";
  /** Local de retiro (sólo modalidad retiro). */
  local?: string | null;
}): ContextoDisponibilidad | null {
  const vivas = ordenadas(entrada.sucursales);
  if (vivas.length === 0) return null;
  const activas = vivas.map((s) => s.slug);
  const zona =
    (entrada.zona && activas.includes(entrada.zona)
      ? entrada.zona
      : undefined) ??
    vivas.find((s) => s.predeterminada)?.slug ??
    activas[0];
  const modalidad = entrada.modalidad ?? "envio";
  const local =
    modalidad === "retiro" && entrada.local && activas.includes(entrada.local)
      ? entrada.local
      : undefined;
  const contarEn =
    modalidad === "retiro" && local
      ? [local]
      : permiteRespaldo("envio", entrada.reglas)
        ? activas
        : [zona];
  return {
    zona,
    activas,
    contarEn,
    stockHeredado: activas[0],
    ...(local ? { local } : {}),
  };
}
