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

/** Una línea de texto por modalidad: el envío y un retiro por cada local. */
export function textosDisponibilidad(
  d: DisponibilidadVista,
  locales: LocalDisponibilidad[],
): string[] {
  const lineas: string[] = [];
  if (d.envio) lineas.push(textoEnvio(d.envio));
  if (d.retiro) {
    for (const l of locales) {
      const r = d.retiro[l.slug];
      if (r) lineas.push(textoRetiro(l.nombre, r));
    }
  }
  return lineas;
}
