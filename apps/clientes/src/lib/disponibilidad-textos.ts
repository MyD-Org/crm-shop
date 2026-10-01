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
 * `conEnvio`: con el envío a domicilio desactivado en el CRM no se promete).
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

// --- Carrito: un solo estado para todo el pedido ---------------------------------------------

/** Cuánto "pesa" un estado: manda el producto más lento. "A coordinar" (0/null días) va al final. */
const pesoDemora = (dias: number | null): number => (dias === null || dias <= 0 ? 10_000 : dias);
const pesoRetiro = (d: DisponibilidadRetiro): number =>
  d.estado === "disponible" ? 0 : d.estado === "con_demora" ? pesoDemora(d.demoraDias) : 100_000;
const pesoEnvio = (d: DisponibilidadEnvio): number =>
  d.estado === "disponible" ? 0 : d.estado === "a_traer" ? pesoDemora(d.demoraDias) : 100_000;

const productos1 = (n: number) => (n === 1 ? "1 producto" : `${n} productos`);

/**
 * Resumen del carrito: por cada local y para el envío, el estado del producto más lento (el pedido
 * sale completo), y por local una nota con cuántos productos se traen de otra sucursal o no están.
 */
export function resumenDisponibilidadCarrito(
  productos: DisponibilidadVista[],
  locales: LocalDisponibilidad[],
): { producto: DisponibilidadVista; notasLocal: Record<string, string> } | null {
  if (productos.length === 0) return null;
  const retiro: Record<string, DisponibilidadRetiro> = {};
  const notasLocal: Record<string, string> = {};
  for (const l of locales) {
    const estados = productos.map((p) => p.retiro?.[l.slug]).filter((r): r is DisponibilidadRetiro => !!r);
    if (estados.length === 0) continue;
    retiro[l.slug] = estados.reduce((peor, r) => (pesoRetiro(r) > pesoRetiro(peor) ? r : peor));
    const aTraer = estados.filter((r) => r.estado === "con_demora").length;
    const no = estados.filter((r) => r.estado === "sin_stock" || r.estado === "oculto").length;
    const notas = [
      aTraer > 0 && `${productos1(aTraer)} se ${aTraer === 1 ? "trae" : "traen"} de otra sucursal`,
      no > 0 && `${productos1(no)} no ${no === 1 ? "está disponible" : "están disponibles"} en este local`,
    ].filter(Boolean);
    if (notas.length > 0) notasLocal[l.slug] = notas.join(" · ");
  }
  const envios = productos.map((p) => p.envio).filter((e): e is DisponibilidadEnvio => !!e);
  const envio = envios.length > 0 ? envios.reduce((peor, e) => (pesoEnvio(e) > pesoEnvio(peor) ? e : peor)) : null;
  return {
    producto: { ...productos[0], retiro: Object.keys(retiro).length > 0 ? retiro : null, envio },
    notasLocal,
  };
}

/** ¿El producto no se puede ni retirar en ningún local ni enviar? (único aviso por ítem del carrito). */
export function sinEntregaPosible(d: DisponibilidadVista): boolean {
  const retiroAlguno = Object.values(d.retiro ?? {}).some((r) => r.estado === "disponible" || r.estado === "con_demora");
  const envioPosible = d.envio ? d.envio.estado === "disponible" || d.envio.estado === "a_traer" : false;
  return !retiroAlguno && !envioPosible;
}
