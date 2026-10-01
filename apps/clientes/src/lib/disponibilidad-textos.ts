/**
 * Textos de disponibilidad por modalidad (ficha, carrito y checkout). Módulo PURO. Registro de usted
 * del Shop; son frases de estado ("Retiro en <local>: disponible hoy"), sin imperativos.
 *
 * Una línea por local y una de envío, sin que el visitante elija nada:
 *   "Retiro en <local>: disponible hoy | disponible en N días | no disponible"
 *   "Envío a domicilio: disponible | disponible en N días | no disponible"
 * Los días salen de "Días de demora al traer de otra sucursal" (reglas de venta del CRM); 0 se dice
 * "a coordinar" (sin plazo numérico).
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
  /** Para la lista de locales de la ficha ("Catamarca 1865, Mar del Plata"). */
  direccion?: string;
  ciudad?: string;
}

/** Plazo cuando hay que traerlo de otra sucursal: "en 3 días"; 0 o sin dato = "a coordinar". */
const plazo = (dias: number | null): string =>
  dias === null || dias <= 0
    ? "a coordinar"
    : `disponible en ${dias} ${dias === 1 ? "día" : "días"}`;

export function textoEnvio(d: DisponibilidadEnvio): string {
  switch (d.estado) {
    case "disponible":
      return "Envío a domicilio: disponible";
    case "a_traer":
      return `Envío a domicilio: ${plazo(d.demoraDias)}`;
    default:
      return "Envío a domicilio: no disponible";
  }
}

export function textoRetiro(
  nombreLocal: string,
  d: DisponibilidadRetiro,
): string {
  switch (d.estado) {
    case "disponible":
      return `Retiro en ${nombreLocal}: disponible hoy`;
    case "con_demora":
      return `Retiro en ${nombreLocal}: ${plazo(d.demoraDias)}`;
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
 * Primero un retiro por cada local (en el orden de los locales) y al final el envío (sólo si
 * `conEnvio`: con el flag `envio` apagado no se promete).
 */
export function lineasDisponibilidad(
  d: DisponibilidadVista,
  locales: LocalDisponibilidad[],
  opts: { conEnvio?: boolean } = {},
): LineaDisponibilidad[] {
  const conEnvio = opts.conEnvio ?? true;
  const lineas: LineaDisponibilidad[] = [];
  if (d.retiro) {
    for (const l of locales) {
      const r = d.retiro[l.slug];
      if (r)
        lineas.push({ texto: textoRetiro(l.nombre, r), tono: tonoRetiro(r) });
    }
  }
  if (conEnvio && d.envio)
    lineas.push({ texto: textoEnvio(d.envio), tono: tonoEnvio(d.envio) });
  return lineas;
}

const mayuscula = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** Estado del retiro sin el "Retiro en <local>:" (la ficha lo pone bajo el nombre del local). */
export function estadoRetiroLocal(d: DisponibilidadRetiro): LineaDisponibilidad {
  const texto =
    d.estado === "disponible"
      ? "Disponible hoy"
      : d.estado === "con_demora"
        ? mayuscula(plazo(d.demoraDias))
        : "No disponible";
  return { texto, tono: tonoRetiro(d) };
}

/** Estado del envío a domicilio sin el prefijo (fila de envío de la ficha). */
export function estadoEnvio(d: DisponibilidadEnvio): LineaDisponibilidad {
  const texto =
    d.estado === "disponible"
      ? "Disponible"
      : d.estado === "a_traer"
        ? mayuscula(plazo(d.demoraDias))
        : "No disponible";
  return { texto, tono: tonoEnvio(d) };
}

/** Sólo los textos (ver `lineasDisponibilidad`). */
export function textosDisponibilidad(
  d: DisponibilidadVista,
  locales: LocalDisponibilidad[],
  opts: { conEnvio?: boolean } = {},
): string[] {
  return lineasDisponibilidad(d, locales, opts).map((l) => l.texto);
}
