/**
 * Textos de disponibilidad por modalidad (ficha, carrito y checkout). Módulo PURO. Registro de usted
 * del Shop; son frases de estado ("Retiro en <local>: disponible hoy"), sin imperativos.
 *
 * Una línea por local y una de envío, sin que el visitante elija nada:
 *   "Retiro en <local>: disponible hoy | disponible en N días | no disponible"
 *   "Envío a domicilio: despacho dentro de las 24 h hábiles | despacho dentro de N días hábiles | no disponible"
 * Los días salen de "Días de demora al traer de otra sucursal" (reglas de venta del CRM); 0 se dice
 * "a coordinar" (sin plazo numérico). El envío promete el DESPACHO, no la llegada: la demora del
 * flete no se conoce. Si hay que traerlo de otra sucursal, es la demora más el día del despacho.
 */
import type { ExcepcionHorario, HorarioSemanal } from "./horario-agrupado";
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
  /** Para el popup "Ver local" (dirección, mapa, horario y WhatsApp). */
  direccion?: string;
  ciudad?: string;
  horario?: string;
  /** Horario estructurado (normalizado en el servidor); el texto legado queda de respaldo. */
  schedule?: HorarioSemanal;
  excepciones?: ExcepcionHorario[];
  whatsapp?: string;
}

/** Plazo cuando hay que traerlo de otra sucursal: "en 3 días"; 0 o sin dato = "a coordinar". */
const plazo = (dias: number | null): string =>
  dias === null || dias <= 0
    ? "a coordinar"
    : `disponible en ${dias} ${dias === 1 ? "día" : "días"}`;

/** Plazo del envío: lo que se compromete es el despacho, no cuándo llega el flete. */
const despacho = (d: DisponibilidadEnvio): string =>
  d.estado === "disponible"
    ? "despacho dentro de las 24 h hábiles"
    : d.demoraDias === null || d.demoraDias <= 0
      ? "a coordinar"
      : `despacho dentro de ${d.demoraDias + 1} días hábiles`;

export function textoEnvio(d: DisponibilidadEnvio): string {
  switch (d.estado) {
    case "disponible":
    case "a_traer":
      return `Envío a domicilio: ${despacho(d)}`;
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
    d.estado === "disponible" || d.estado === "a_traer" ? mayuscula(despacho(d)) : "No disponible";
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
export const pesoRetiro =(d: DisponibilidadRetiro): number =>
  d.estado === "disponible" ? 0 : d.estado === "con_demora" ? pesoDemora(d.demoraDias) : 100_000;
const pesoEnvio = (d: DisponibilidadEnvio): number =>
  d.estado === "disponible" ? 0 : d.estado === "a_traer" ? pesoDemora(d.demoraDias) : 100_000;

/** Un producto del carrito con su estado en un local (detalle del popup "Ver local"). */
export interface EstadoProductoLocal {
  nombre: string;
  estado: LineaDisponibilidad;
}

/**
 * Resumen del carrito: por cada local y para el envío, el estado del producto más lento (el pedido
 * sale completo), y por local el estado de cada producto para el popup "Ver local".
 */
export function resumenDisponibilidadCarrito(
  productos: { nombre: string; disp: DisponibilidadVista }[],
  locales: LocalDisponibilidad[],
): { producto: DisponibilidadVista; detallePorLocal: Record<string, EstadoProductoLocal[]> } | null {
  if (productos.length === 0) return null;
  const retiro: Record<string, DisponibilidadRetiro> = {};
  const detallePorLocal: Record<string, EstadoProductoLocal[]> = {};
  for (const l of locales) {
    const conEstado = productos
      .map((p) => ({ nombre: p.nombre, r: p.disp.retiro?.[l.slug] }))
      .filter((x): x is { nombre: string; r: DisponibilidadRetiro } => !!x.r);
    if (conEstado.length === 0) continue;
    retiro[l.slug] = conEstado.reduce((peor, x) => (pesoRetiro(x.r) > pesoRetiro(peor) ? x.r : peor), conEstado[0].r);
    detallePorLocal[l.slug] = conEstado.map((x) => ({ nombre: x.nombre, estado: estadoRetiroLocal(x.r) }));
  }
  const envios = productos.map((p) => p.disp.envio).filter((e): e is DisponibilidadEnvio => !!e);
  const envio = envios.length > 0 ? envios.reduce((peor, e) => (pesoEnvio(e) > pesoEnvio(peor) ? e : peor)) : null;
  return {
    producto: { ...productos[0].disp, retiro: Object.keys(retiro).length > 0 ? retiro : null, envio },
    detallePorLocal,
  };
}

/** Locales con retiro ordenados del que mejor sirve al que peor (hoy → con demora → no disponible). */
export function localesPorConveniencia(
  locales: LocalDisponibilidad[],
  retiro: Record<string, DisponibilidadRetiro>,
): LocalDisponibilidad[] {
  return locales
    .filter((l) => retiro[l.slug])
    .map((l, i) => ({ l, i }))
    .sort((a, b) => pesoRetiro(retiro[a.l.slug]) - pesoRetiro(retiro[b.l.slug]) || a.i - b.i)
    .map((x) => x.l);
}

/** ¿El producto no se puede ni retirar en ningún local ni enviar? (único aviso por ítem del carrito). */
export function sinEntregaPosible(d: DisponibilidadVista): boolean {
  const retiroAlguno = Object.values(d.retiro ?? {}).some((r) => r.estado === "disponible" || r.estado === "con_demora");
  const envioPosible = d.envio ? d.envio.estado === "disponible" || d.envio.estado === "a_traer" : false;
  return !retiroAlguno && !envioPosible;
}

// --- Checkout: un solo mensaje de entrega para todo el pedido ---------------------------------

/**
 * Entrega del pedido en la modalidad elegida. `productos` trae la disponibilidad ya recortada a esa
 * modalidad (sólo el envío, o sólo el local de retiro elegido). Devuelve:
 *  - `resumen`: UNA línea con el estado del producto más lento (sin contar los que no se pueden
 *    entregar), o null si no hay nada que decir;
 *  - `aclaracion`: si no todos los productos tienen el mismo estado, cuántos se traen de otra
 *    sucursal;
 *  - `sinEntrega`: ids de los productos que NO se pueden entregar en esta modalidad (llevan su
 *    propio aviso).
 */
export function resumenEntregaPedido(
  productos: { id: string; disp: DisponibilidadVista }[],
  locales: LocalDisponibilidad[],
  opts: { conEnvio?: boolean } = {},
): { resumen: LineaDisponibilidad | null; aclaracion: string | null; sinEntrega: string[] } {
  const sinEntrega: string[] = [];
  const entregables: { id: string; disp: DisponibilidadVista; linea: LineaDisponibilidad }[] = [];
  for (const p of productos) {
    const linea = lineasDisponibilidad(p.disp, locales, opts)[0];
    if (!linea) continue;
    if (linea.tono === "no") sinEntrega.push(p.id);
    else entregables.push({ ...p, linea });
  }
  const peor = resumenDisponibilidadCarrito(
    entregables.map((p) => ({ nombre: p.id, disp: p.disp })),
    locales,
  );
  const resumen = peor ? (lineasDisponibilidad(peor.producto, locales, opts)[0] ?? null) : null;
  const textos = new Set(entregables.map((p) => p.linea.texto));
  const aTraer = entregables.filter((p) => p.linea.tono === "demora").length;
  // Sólo en el retiro: explica por qué el local tarda. En el envío, de qué sucursal sale es
  // logística interna; al cliente le alcanza con el plazo.
  const esRetiro = Boolean(peor?.producto.retiro && Object.keys(peor.producto.retiro).length > 0);
  const aclaracion =
    esRetiro && textos.size > 1 && aTraer > 0
      ? `${aTraer} ${aTraer === 1 ? "producto se trae" : "productos se traen"} de otra sucursal`
      : null;
  return { resumen, aclaracion, sinEntrega };
}
