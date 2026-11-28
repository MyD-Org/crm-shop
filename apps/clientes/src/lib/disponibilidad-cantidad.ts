/**
 * Disponibilidad de la ficha según la cantidad elegida y el texto del stock por local. Módulo PURO
 * (corre en el navegador): sólo elige entre lo que ya calculó el servidor (`conTramosPorCantidad`),
 * no aplica reglas propias.
 *
 * Por qué: el número de la ficha es el del catálogo (el mejor local, igual para todos) y al lado
 * dice «Retiro en Mar del Plata: disponible hoy». Con 2 en Mar del Plata y 21 en Iguazú se leía
 * como 21 en Mar del Plata. Ahora el número dice de qué local es y, si el visitante pide más de lo
 * que hay ahí, el plazo cambia (la línea entera viene de la otra sucursal).
 */
import {
  estadoEnvio,
  estadoRetiroLocal,
  type DisponibilidadVista,
  type LocalDisponibilidad,
} from "./disponibilidad-textos";
import { STOCK_BAJO } from "./stock-bajo";

/** La vista que vale para `qty` unidades: el último tramo que alcanza, o la base (1 unidad). */
export function vistaParaCantidad(v: DisponibilidadVista, qty: number): DisponibilidadVista {
  let tramo = null;
  for (const t of v.tramos ?? []) if (t.desde <= qty) tramo = t;
  return tramo ? { ...v, envio: tramo.envio, retiro: tramo.retiro } : v;
}

/** Desde qué tramo cambia lo que se muestra para `qty`: sirve de clave para elegir el slot de envío. */
export function desdeParaCantidad(v: DisponibilidadVista | undefined, qty: number): number {
  let desde = 1;
  for (const t of v?.tramos ?? []) if (t.desde <= qty) desde = t.desde;
  return desde;
}

export interface StockPorLocal {
  /** Texto de la etiqueta: «En stock en Mar del Plata: 2 disponibles» («Últimas unidades …» con 1). */
  texto: string;
  tono: "ok" | "demora";
  /** Debajo, si otra sucursal tiene más: «Más de 2 unidades: disponible en 7 días». */
  detalle?: string;
}

const miles = new Intl.NumberFormat("es-AR");
const unidadesTexto = (n: number) => `${miles.format(n)} ${n === 1 ? "disponible" : "disponibles"}`;
const minuscula = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
/** Mismo criterio que el catálogo (`derivarStock`): con menos de `STOCK_BAJO`, «Últimas unidades». */
const enLocal = (nombre: string, n: number): Pick<StockPorLocal, "texto" | "tono"> =>
  n < STOCK_BAJO
    ? { texto: `Últimas unidades en ${nombre}: ${unidadesTexto(n)}`, tono: "demora" }
    : { texto: `En stock en ${nombre}: ${unidadesTexto(n)}`, tono: "ok" };

/**
 * El stock de la etiqueta de la ficha, dicho por local.
 *
 * - Con un local de referencia (retiro elegido, o la sucursal de la zona con envío elegido): las
 *   unidades de ESE local y, si otra sucursal tiene más, desde cuántas cambia el plazo (con el
 *   texto del tramo, la misma regla del pedido). Sin unidades ahí: «Sin stock en <local>».
 * - Sin ubicación elegida (la zona sería la predeterminada, no la del visitante): cuántas hay en
 *   cada local, sin suponer cuál es el suyo.
 *
 * `null` = no hay datos por sucursal (flag apagado, no inventariable o una sucursal sin nombre): la
 * ficha muestra la etiqueta de siempre.
 */
export function stockPorLocal(
  v: DisponibilidadVista | undefined,
  locales: LocalDisponibilidad[],
  referencia: { local: string; modalidad: "retiro" | "envio" } | null,
): StockPorLocal | null {
  const unidades = v?.unidades;
  if (!v || !unidades) return null;
  const nombre = (slug: string) => locales.find((l) => l.slug === slug)?.nombre;
  const conStock = Object.entries(unidades).filter(([, n]) => n > 0);
  if (conStock.length === 0) return null;

  const ref = referencia && referencia.local in unidades ? referencia : null;
  const nombreRef = ref ? nombre(ref.local) : undefined;
  if (ref && nombreRef) {
    const aca = unidades[ref.local];
    const masEnOtra = Math.max(0, ...Object.entries(unidades).filter(([s]) => s !== ref.local).map(([, n]) => n));
    const detalle = aca < masEnOtra ? detalleDesde(v, aca + 1, ref) : undefined;
    if (aca > 0) return { ...enLocal(nombreRef, aca), ...(detalle ? { detalle } : {}) };
    return { texto: `Sin stock en ${nombreRef}`, tono: "demora", ...(detalle ? { detalle } : {}) };
  }

  // Sin local de referencia: una sola sucursal con stock se nombra; varias, cada una con lo suyo.
  const nombradas = conStock.map(([s, n]) => ({ s, n, nombre: nombre(s) }));
  if (nombradas.some((x) => !x.nombre)) return null;
  if (nombradas.length === 1) {
    return enLocal(nombradas[0].nombre!, nombradas[0].n);
  }
  const orden = (s: string) => locales.findIndex((l) => l.slug === s);
  const partes = nombradas.sort((a, b) => orden(a.s) - orden(b.s)).map((x) => `${miles.format(x.n)} en ${x.nombre}`);
  return { texto: `En stock: ${partes.join(" · ")}`, tono: "ok" };
}

/**
 * «Más de 2 unidades: disponible en 7 días» (o «Hasta 21 unidades: …» si el local no tiene). Sale
 * del tramo que empieza en `desde`; si ese tramo no promete nada (sin respaldo), no hay detalle.
 */
function detalleDesde(
  v: DisponibilidadVista,
  desde: number,
  ref: { local: string; modalidad: "retiro" | "envio" },
): string | undefined {
  const tramo = vistaParaCantidad(v, desde);
  const estado =
    ref.modalidad === "retiro"
      ? tramo.retiro?.[ref.local] && ["con_demora", "por_pedido"].includes(tramo.retiro[ref.local].estado)
        ? estadoRetiroLocal(tramo.retiro[ref.local]).texto
        : null
      : tramo.envio && ["a_traer", "por_pedido"].includes(tramo.envio.estado)
        ? estadoEnvio(tramo.envio).texto
        : null;
  if (!estado) return undefined;
  const hasta = Math.max(0, ...Object.values(v.unidades ?? {}));
  const cuantas =
    desde > 1
      ? `Más de ${miles.format(desde - 1)} ${desde - 1 === 1 ? "unidad" : "unidades"}`
      : `Hasta ${miles.format(hasta)} ${hasta === 1 ? "unidad" : "unidades"}`;
  return `${cuantas}: ${minuscula(estado)}`;
}
