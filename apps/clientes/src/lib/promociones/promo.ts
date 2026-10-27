/**
 * Lógica pura de la promo de la home (spec 2026-10-26-promociones-home): vigencia, contador de
 * unidades, ahorro contra la referencia de mercado, fechas en hora de Argentina y legales. Sin base,
 * sin caché y sin reloj propio: quien llama pasa `ahora`.
 */
import type { Product } from "@/data/products";
import type { EstrellaPromo, PromocionesContent } from "./tipos";

export const ZONA_AR = "America/Argentina/Buenos_Aires";
/** Argentina no tiene horario de verano: el offset es fijo. */
const OFFSET_AR = "-03:00";
const OFFSET_AR_MS = -3 * 3600 * 1000;

export const ETIQUETA_BADGE_DEFAULT = "Precio de apertura";
export const ETIQUETA_REFERENCIA_DEFAULT = "En otras tiendas desde";
export const LEGALES_DEFAULT =
  "Promoción válida del {inicio} al {fin} o hasta agotar {unidades} unidades del producto estrella. Precios finales con IVA para pago por transferencia. Stock sujeto a disponibilidad.";
export const MAX_ITEMS_PROMO = 6;
/** Desde cuántas unidades restantes (inclusive) se avisa "¡Últimas unidades!". */
const UMBRAL_ULTIMAS = 2;

export type EstadoPromo = "inactiva" | "programada" | "vigente" | "terminada";

/** "inactiva" = sin fin o sin productos; el resto compara `ahora` con inicio/fin (fin exclusivo). */
export function estadoPromo(
  p: Pick<PromocionesContent, "inicio" | "fin" | "estrella" | "items">,
  ahora: number,
): EstadoPromo {
  const hayProductos = !!p.estrella?.sku || (p.items?.length ?? 0) > 0;
  const fin = p.fin ? Date.parse(p.fin) : NaN;
  if (!hayProductos || Number.isNaN(fin)) return "inactiva";
  const inicio = p.inicio ? Date.parse(p.inicio) : NaN;
  if (!Number.isNaN(inicio) && ahora < inicio) return "programada";
  return ahora < fin ? "vigente" : "terminada";
}

/**
 * Unidades a precio de apertura que quedan: las vendidas son lo que bajó el stock de la sucursal
 * desde que se cargó la promo. Nunca más que `unidadesPromo` (una reposición no las aumenta) ni
 * menos que 0. `null` = la estrella no tiene contador.
 */
export function unidadesQuedan(
  e: Pick<EstrellaPromo, "unidadesPromo" | "stockBase">,
  stockActual: number | null,
): number | null {
  if (!e.unidadesPromo) return null;
  const actual = stockActual ?? 0;
  const vendidas = Math.max(0, (e.stockBase ?? actual) - actual);
  const quedan = Math.min(e.unidadesPromo - vendidas, e.unidadesPromo, actual);
  return Math.max(0, quedan);
}

export function esUltimas(quedan: number | null): boolean {
  return quedan !== null && quedan > 0 && quedan <= UMBRAL_ULTIMAS;
}

/** Ahorro (%, hacia abajo) del precio contra la referencia; null si no hay ahorro real. */
export function porcentajeAhorro(precio: number, referencia?: number): number | null {
  if (!referencia || referencia <= precio || precio <= 0) return null;
  const pct = Math.floor(((referencia - precio) / referencia) * 100);
  return pct > 0 ? pct : null;
}

/** El precio que la promo muestra grande: el del medio destacado (transferencia) con IVA. */
export function precioPrincipal(
  p: Pick<Product, "price" | "precioFinal" | "precioMedio">,
): { monto: number; esTransferencia: boolean } {
  if (p.precioMedio) return { monto: p.precioMedio.precioFinal ?? p.precioMedio.price, esTransferencia: true };
  return { monto: p.precioFinal ?? p.price, esTransferencia: false };
}

const normalizar = (sku: string) => sku.trim().toUpperCase();

/** SKUs de la promo normalizados, la estrella primero y sin repetidos. */
export function skusPromo(p: Pick<PromocionesContent, "estrella" | "items">): string[] {
  const todos = [p.estrella?.sku, ...(p.items ?? []).map((i) => i.sku)]
    .filter((s): s is string => typeof s === "string")
    .map(normalizar)
    .filter(Boolean);
  return [...new Set(todos)];
}

/** Valor de un `<input type="datetime-local">` (hora de Argentina) → ISO con offset. */
export function aIsoArgentina(local: string): string {
  const base = local.length === 16 ? `${local}:00` : local;
  return `${base}${OFFSET_AR}`;
}

/** ISO cualquiera → valor de `datetime-local` en hora de Argentina. */
export function deIsoArgentina(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms + OFFSET_AR_MS).toISOString().slice(0, 16);
}

/** "13/11" en hora de Argentina. */
export function fechaCortaAR(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: ZONA_AR, day: "numeric", month: "numeric" }).format(
    new Date(iso),
  );
}

/** Reemplaza {inicio} {fin} {unidades}. Sin inicio, la fecha de hoy. */
export function textoLegales(plantilla: string, datos: { inicio?: string; fin: string; unidades?: number }): string {
  const inicio = fechaCortaAR(datos.inicio ?? new Date().toISOString());
  return plantilla
    .replaceAll("{inicio}", inicio)
    .replaceAll("{fin}", fechaCortaAR(datos.fin))
    .replaceAll("{unidades}", datos.unidades !== undefined ? String(datos.unidades) : "las");
}

/** Tiempo que falta para el fin; null si ya terminó. */
export function restante(fin: string, ahora: number): { d: number; h: number; m: number; s: number } | null {
  const falta = Date.parse(fin) - ahora;
  if (Number.isNaN(falta) || falta <= 0) return null;
  const total = Math.floor(falta / 1000);
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

/**
 * Lo mínimo de la promo que viaja al navegador (contexto del layout) para badges y ficha. Sin fin
 * o sin productos no viaja nada. La vigencia la decide el cliente con `infoPromoDe`.
 */
export type DatosPromoCliente = {
  inicio?: string;
  fin: string;
  etiquetaBadge: string;
  etiquetaReferencia: string;
  legales?: string;
  estrellaSku?: string;
  unidadesPromo?: number;
  /** SKU normalizado → precio de referencia (undefined = sin referencia). */
  refs: Record<string, number | undefined>;
};

export function datosPromoCliente(p: PromocionesContent): DatosPromoCliente | null {
  const skus = skusPromo(p);
  if (!p.fin || skus.length === 0) return null;
  const refs: Record<string, number | undefined> = {};
  if (p.estrella?.sku) refs[normalizar(p.estrella.sku)] = p.estrella.precioReferencia;
  for (const i of p.items ?? []) {
    const k = normalizar(i.sku);
    if (k && !(k in refs)) refs[k] = i.precioReferencia;
  }
  return {
    inicio: p.inicio,
    fin: p.fin,
    etiquetaBadge: p.etiquetaBadge,
    etiquetaReferencia: p.etiquetaReferencia,
    legales: p.legales,
    estrellaSku: p.estrella?.sku ? normalizar(p.estrella.sku) : undefined,
    unidadesPromo: p.estrella?.unidadesPromo,
    refs,
  };
}

export type InfoPromoProducto = {
  etiquetaBadge: string;
  etiquetaReferencia: string;
  referencia?: number;
  inicio?: string;
  fin: string;
  legales?: string;
  unidadesPromo?: number;
  esEstrella: boolean;
};

/** ¿La promo que viajó al cliente está vigente en `ahora`? */
export function promoClienteVigente(datos: DatosPromoCliente | null, ahora: number): boolean {
  return !!datos && estadoPromo({ inicio: datos.inicio, fin: datos.fin, items: [{ sku: "_" }] }, ahora) === "vigente";
}

/** La promo de UN producto (por SKU exacto) si está vigente en `ahora`; si no, null. */
export function infoPromoDe(datos: DatosPromoCliente | null, sku: string | undefined, ahora: number): InfoPromoProducto | null {
  return promoClienteVigente(datos, ahora) ? infoPromoSku(datos, sku) : null;
}

/** El dato de la promo de UN producto, sin mirar la fecha (la vigencia la decide quien llama). */
export function infoPromoSku(datos: DatosPromoCliente | null, sku: string | undefined): InfoPromoProducto | null {
  if (!datos || !sku) return null;
  const k = normalizar(sku);
  if (!(k in datos.refs)) return null;
  return {
    etiquetaBadge: datos.etiquetaBadge,
    etiquetaReferencia: datos.etiquetaReferencia,
    referencia: datos.refs[k],
    inicio: datos.inicio,
    fin: datos.fin,
    legales: datos.legales,
    unidadesPromo: datos.unidadesPromo,
    esEstrella: datos.estrellaSku === k,
  };
}
