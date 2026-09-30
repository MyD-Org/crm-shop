/**
 * Textos de disponibilidad por modalidad (ficha, carrito y checkout). Módulo PURO. Registro de usted
 * del Shop; son frases de estado ("Envío: disponible"), sin imperativos.
 *
 * Reglas (spec de la rebanada B): "Envío: disponible" y "Retiro en <local>: disponible | con demora
 * de N días | no disponible". La demora 0 se dice "a coordinar" (sin plazo numérico).
 */
import type {
  DisponibilidadEnvio,
  DisponibilidadProducto,
  DisponibilidadRetiro,
} from "./sucursales-disponibilidad";

/** Disponibilidad de un producto en las dos modalidades (lo que viaja al browser). */
export type DisponibilidadVista = DisponibilidadProducto;

export interface LocalDisponibilidad {
  slug: string;
  nombre: string;
}

const demora = (dias: number | null): string =>
  dias === null || dias <= 0
    ? "a coordinar"
    : `con demora de ${dias} ${dias === 1 ? "día" : "días"}`;

export function textoEnvio(d: DisponibilidadEnvio): string {
  switch (d.estado) {
    case "disponible":
      return "Envío: disponible";
    case "a_traer":
      return `Envío: disponible ${demora(d.demoraDias)}`;
    default:
      return "Envío: no disponible";
  }
}

export function textoRetiro(
  nombreLocal: string,
  d: DisponibilidadRetiro,
): string {
  switch (d.estado) {
    case "disponible":
      return `Retiro en ${nombreLocal}: disponible`;
    case "con_demora":
      return `Retiro en ${nombreLocal}: ${demora(d.demoraDias)}`;
    default:
      return `Retiro en ${nombreLocal}: no disponible`;
  }
}

/** Cómo se pinta una línea: disponible, con demora o no disponible. */
export type TonoDisponibilidad = "ok" | "demora" | "no";

export interface LineaDisponibilidad {
  texto: string;
  tono: TonoDisponibilidad;
}

const tonoEnvio = (d: DisponibilidadEnvio): TonoDisponibilidad =>
  d.estado === "disponible" ? "ok" : d.estado === "a_traer" ? "demora" : "no";

const tonoRetiro = (d: DisponibilidadRetiro): TonoDisponibilidad =>
  d.estado === "disponible"
    ? "ok"
    : d.estado === "con_demora"
      ? "demora"
      : "no";

/**
 * Una línea por modalidad: el envío (sólo si `conEnvio`: con el flag `envio` apagado no se
 * promete) y un retiro por cada local.
 */
export function lineasDisponibilidad(
  d: DisponibilidadVista,
  locales: LocalDisponibilidad[],
  opts: { conEnvio?: boolean } = {},
): LineaDisponibilidad[] {
  const conEnvio = opts.conEnvio ?? true;
  const lineas: LineaDisponibilidad[] = [];
  if (conEnvio && d.envio)
    lineas.push({ texto: textoEnvio(d.envio), tono: tonoEnvio(d.envio) });
  if (d.retiro) {
    for (const l of locales) {
      const r = d.retiro[l.slug];
      if (r)
        lineas.push({ texto: textoRetiro(l.nombre, r), tono: tonoRetiro(r) });
    }
  }
  return lineas;
}

/** Sólo los textos (ver `lineasDisponibilidad`). */
export function textosDisponibilidad(
  d: DisponibilidadVista,
  locales: LocalDisponibilidad[],
  opts: { conEnvio?: boolean } = {},
): string[] {
  return lineasDisponibilidad(d, locales, opts).map((l) => l.texto);
}
