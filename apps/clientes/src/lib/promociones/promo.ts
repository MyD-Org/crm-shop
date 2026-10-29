/**
 * Lógica pura de la promo de la home (spec 2026-10-26-promociones-home): vigencia, contador de
 * unidades, ahorro contra la referencia de mercado, fechas en hora de Argentina y legales. Sin base,
 * sin caché y sin reloj propio: quien llama pasa `ahora`.
 */
import type { Product } from "@/data/products";
import type { EstrellaPromo, PromocionesContent, Referencia } from "./tipos";

export const ZONA_AR = "America/Argentina/Buenos_Aires";
/** Argentina no tiene horario de verano: el offset es fijo. */
const OFFSET_AR = "-03:00";
const OFFSET_AR_MS = -3 * 3600 * 1000;

export const ETIQUETA_BADGE_DEFAULT = "Precio de apertura";
/** Máximo de referencias por producto en la escalera. */
export const MAX_REFERENCIAS = 3;
/** Nombres sugeridos para las filas de la escalera (el admin puede escribir otro). */
export const ETIQUETAS_REFERENCIA_SUGERIDAS = ["Tiendas online", "Casas de iluminación", "Cadenas de electro"] as const;
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

/** Cuánto se ahorra (pesos enteros) frente a la referencia; null si no hay ahorro real. */
export function ahorroPesos(precio: number, referencia?: number): number | null {
  if (!referencia || referencia <= precio) return null;
  const pesos = Math.round(referencia - precio);
  return pesos > 0 ? pesos : null;
}

/** Descuento contra NUESTRO precio habitual (el tachado): % hacia abajo y pesos; null sin rebaja real. */
export function descuentoPropio(precio: number, habitual?: number): { pct: number; pesos: number } | null {
  const pct = porcentajeAhorro(precio, habitual);
  const pesos = ahorroPesos(precio, habitual);
  return pct && pesos ? { pct, pesos } : null;
}

export type Escalera = {
  /** Las referencias más caras que nuestro precio, de mayor a menor; `ancho` relativo a la mayor (0..1]. */
  filas: (Referencia & { ancho: number })[];
  /** Ancho de nuestra barra. */
  ancho: number;
  /** Diferencia contra la referencia más cara (pesos enteros). */
  ahorroMax: number;
};

/** La escalera de comparación; null si ninguna referencia es más cara que nuestro precio. */
export function escaleraPrecios(precio: number, referencias?: Referencia[]): Escalera | null {
  const mayores = (referencias ?? []).filter((r) => r.precio > precio).sort((a, b) => b.precio - a.precio);
  if (mayores.length === 0) return null;
  const max = mayores[0].precio;
  return {
    filas: mayores.map((r) => ({ ...r, ancho: r.precio / max })),
    ancho: precio / max,
    ahorroMax: Math.round(max - precio),
  };
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

/**
 * SKUs cargados en la promo que no se dibujan (oculto, borrado o, si es un item, sin stock), como los
 * escribió el admin (sin espacios) y sin repetidos. `resueltos` = los SKUs de lo que sí se muestra.
 */
export function skusNoResueltos(p: Pick<PromocionesContent, "estrella" | "items">, resueltos: string[]): string[] {
  const vistos = new Set(resueltos.map(normalizar));
  const salida: string[] = [];
  for (const sku of [p.estrella?.sku, ...(p.items ?? []).map((i) => i.sku)]) {
    const limpio = typeof sku === "string" ? sku.trim() : "";
    if (!limpio || vistos.has(normalizar(limpio))) continue;
    vistos.add(normalizar(limpio));
    salida.push(limpio);
  }
  return salida;
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
  tituloComparador?: string;
  legales?: string;
  estrellaSku?: string;
  unidadesPromo?: number;
  /** SKU normalizado → precio habitual y referencias (ausentes = sin tachado / sin comparación). */
  productos: Record<string, { habitual?: number; referencias?: Referencia[] }>;
};

export function datosPromoCliente(p: PromocionesContent): DatosPromoCliente | null {
  const skus = skusPromo(p);
  if (!p.fin || skus.length === 0) return null;
  const productos: DatosPromoCliente["productos"] = {};
  for (const i of [p.estrella, ...(p.items ?? [])]) {
    const k = i?.sku ? normalizar(i.sku) : "";
    if (k && !(k in productos)) productos[k] = { habitual: i!.precioHabitual, referencias: i!.referencias };
  }
  return {
    inicio: p.inicio,
    fin: p.fin,
    etiquetaBadge: p.etiquetaBadge,
    tituloComparador: p.tituloComparador,
    legales: p.legales,
    estrellaSku: p.estrella?.sku ? normalizar(p.estrella.sku) : undefined,
    unidadesPromo: p.estrella?.unidadesPromo,
    productos,
  };
}

export type InfoPromoProducto = {
  etiquetaBadge: string;
  tituloComparador?: string;
  habitual?: number;
  referencias?: Referencia[];
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
  const producto = datos.productos[k];
  if (!producto) return null;
  return {
    etiquetaBadge: datos.etiquetaBadge,
    tituloComparador: datos.tituloComparador,
    habitual: producto.habitual,
    referencias: producto.referencias,
    inicio: datos.inicio,
    fin: datos.fin,
    legales: datos.legales,
    unidadesPromo: datos.unidadesPromo,
    esEstrella: datos.estrellaSku === k,
  };
}

/**
 * La etiqueta de la promo ("Precio de lanzamiento") dentro de una oración: "¡Últimas 5 unidades a
 * precio de lanzamiento!". Baja la inicial salvo que la primera palabra sea una sigla ("LED").
 */
export function enFrase(etiqueta: string): string {
  const t = etiqueta.trim();
  const primera = t.split(/\s+/)[0] ?? "";
  if (primera.length > 1 && primera === primera.toUpperCase()) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/**
 * La sección asociada a una campaña de precios (spec 2026-10-28-campanias-precios-design.md): las
 * fechas son las de la campaña y, en cada producto que la campaña alcanza, el precio habitual que se
 * tacha es el NORMAL de la misma lista que se muestra grande (el del medio destacado si lo hay; si no,
 * el de lista) y las unidades de la estrella son las de la regla. Lo cargado a mano queda para los
 * productos sin campaña. Sin campaña asociada (o inexistente) devuelve el mismo contenido.
 */
export function contenidoConCampania(
  contenido: PromocionesContent,
  campania: { id: string; inicio: string; fin: string } | undefined,
  productos: readonly Product[],
): PromocionesContent {
  if (!contenido.campaniaId || !campania || campania.id !== contenido.campaniaId) return contenido;
  const porSku = new Map(productos.map((p) => [normalizar(p.sku ?? ""), p]));
  const habitual = (sku: string): number | undefined => {
    const p = porSku.get(normalizar(sku));
    if (!p?.campania) return undefined;
    return p.precioMedio ? p.campania.habitualMedio : p.oldPrice;
  };
  const conHabitual = <T extends { sku: string; precioHabitual?: number }>(i: T): T => {
    const h = habitual(i.sku);
    return h !== undefined ? { ...i, precioHabitual: h } : i;
  };
  const estrella = contenido.estrella ? conHabitual(contenido.estrella) : undefined;
  const unidades = estrella ? porSku.get(normalizar(estrella.sku))?.campania?.unidades : undefined;
  return {
    ...contenido,
    inicio: campania.inicio,
    fin: campania.fin,
    ...(estrella ? { estrella: unidades != null ? { ...estrella, unidadesPromo: unidades } : estrella } : {}),
    items: contenido.items.map(conHabitual),
  };
}

/**
 * La etiqueta de una campaña dentro de una frase ("a precio de Black Friday", "Precio de apertura"):
 * si ya empieza con "Precio" se usa tal cual (sin duplicar "Precio de Precio de…"); si no, se le
 * antepone "precio de" y conserva sus mayúsculas. `mayuscula` = al principio de un rótulo.
 */
export function frasePrecio(etiqueta: string, mayuscula = false): string {
  const t = etiqueta.trim();
  const frase = /^precio\b/i.test(t) ? enFrase(t) : `precio de ${t}`;
  return mayuscula ? frase.charAt(0).toUpperCase() + frase.slice(1) : frase;
}
