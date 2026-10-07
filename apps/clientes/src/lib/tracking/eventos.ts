/**
 * Eventos de ecommerce del Shop y su traducción a cada proveedor.
 *
 * Los componentes sólo conocen `EventoTracking` (lo disparan con `track()`,
 * src/lib/tracking/track.ts). Qué nombre y qué forma tiene en Meta, GA4 o
 * PostHog se decide acá, en funciones puras.
 *
 * Precios: los ítems llevan el precio NETO de la lista del visitante (el mismo
 * que guarda el carrito); `pedido_confirmado` lleva el total real del pedido
 * que devolvió /api/pedidos. `pedido_confirmado` se dispara al CREAR el pedido,
 * no al acreditarse el pago de Mercado Pago.
 */

export const MONEDA = "ARS";

export interface ItemTracking {
  id: string;
  nombre: string;
  marca?: string;
  precio: number;
  cantidad: number;
}

export type EventoTracking =
  | { tipo: "ver_producto"; item: ItemTracking }
  | { tipo: "agregar_carrito"; items: ItemTracking[] }
  | { tipo: "iniciar_checkout"; items: ItemTracking[] }
  | { tipo: "pedido_confirmado"; pedidoId: string; numero?: string | number; total: number; items: ItemTracking[] };

/** Desde dónde se abrió el chat en la búsqueda. */
export type OrigenConversar = "franja" | "sin_resultados" | "pregunta";

/**
 * Eventos de la búsqueda v2 (spec platform 2026-10-01, "Telemetría"). Sólo van a PostHog: no
 * son de ecommerce (ni Meta ni GA4 los entienden). Sin datos personales: la consulta viaja
 * normalizada y sólo si no parece un email o un teléfono (`normalizarConsulta`).
 */
export type EventoBusqueda =
  | {
      tipo: "busqueda_enviada";
      intencion: string;
      fuente: string;
      total: number;
      duros: number;
      blandos: number;
      ms_jev: number | null;
      /** Normalizada; ausente si parecía un dato personal. */
      consulta?: string;
      /** Etapa del motor de búsqueda que resolvió (codigo, plan, exacta, tolerante, vacio…); ausente en lectores viejos. */
      etapa?: string;
    }
  /** `chip`: qué se quitó (en PostHog va como `tipo`). */
  | { tipo: "busqueda_chip_quitado"; chip: "categoria" | "atributo"; valor: string }
  | { tipo: "busqueda_ver_tal_cual" }
  | { tipo: "busqueda_conversar"; origen: OrigenConversar }
  | { tipo: "busqueda_resultado_click"; posicion: number; ia: boolean }
  /**
   * Uso de un filtro por característica del panel (`?car=`): qué clave (`polos`, `curva`...), si se tildó,
   * se destildó o se movió un rango y, en las listas, el valor. Las claves y los valores salen del registro
   * cerrado de `catalogo-facetas-registro.ts`: nunca texto libre de la persona.
   */
  | { tipo: "busqueda_filtro_car"; clave: string; accion: "agregar" | "quitar" | "rango"; valor?: string };

/** Todo lo que el Shop puede mandar por `track()`. */
export type EventoShop = EventoTracking | EventoBusqueda;

const TIPOS_BUSQUEDA = new Set<EventoShop["tipo"]>([
  "busqueda_enviada",
  "busqueda_chip_quitado",
  "busqueda_ver_tal_cual",
  "busqueda_conversar",
  "busqueda_resultado_click",
  "busqueda_filtro_car",
]);

export function esEventoBusqueda(e: EventoShop): e is EventoBusqueda {
  return TIPOS_BUSQUEDA.has(e.tipo);
}

type Params = Record<string, unknown>;

function itemsDe(e: EventoTracking): ItemTracking[] {
  return e.tipo === "ver_producto" ? [e.item] : e.items;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Valor del evento: el total del pedido, o precio × cantidad de los ítems. */
export function valorDe(e: EventoTracking): number {
  if (e.tipo === "pedido_confirmado") return redondear(e.total);
  return redondear(itemsDe(e).reduce((s, i) => s + i.precio * i.cantidad, 0));
}

const unidades = (items: ItemTracking[]) => items.reduce((s, i) => s + i.cantidad, 0);

// --- Meta Pixel ----------------------------------------------------------------

const NOMBRES_META = {
  ver_producto: "ViewContent",
  agregar_carrito: "AddToCart",
  iniciar_checkout: "InitiateCheckout",
  pedido_confirmado: "Purchase",
} as const;

/**
 * `fbq('track', nombre, params, opciones)`. El Purchase lleva `eventID` fijo
 * por pedido: si mañana se suma la API de conversiones (server), Meta
 * deduplica los dos envíos con ese id.
 */
export function aMeta(e: EventoTracking): { nombre: string; params: Params; opciones?: { eventID: string } } {
  const items = itemsDe(e);
  const params: Params = {
    content_ids: items.map((i) => i.id),
    content_type: "product",
    contents: items.map((i) => ({ id: i.id, quantity: i.cantidad })),
    value: valorDe(e),
    currency: MONEDA,
  };
  if (e.tipo === "ver_producto") params.content_name = e.item.nombre;
  if (e.tipo === "iniciar_checkout" || e.tipo === "pedido_confirmado") params.num_items = unidades(items);
  return e.tipo === "pedido_confirmado"
    ? { nombre: NOMBRES_META[e.tipo], params, opciones: { eventID: `pedido-${e.pedidoId}` } }
    : { nombre: NOMBRES_META[e.tipo], params };
}

// --- GA4 -----------------------------------------------------------------------

const NOMBRES_GA4 = {
  ver_producto: "view_item",
  agregar_carrito: "add_to_cart",
  iniciar_checkout: "begin_checkout",
  pedido_confirmado: "purchase",
} as const;

/** `gtag('event', nombre, params)` con el esquema de ecommerce de GA4. */
export function aGa4(e: EventoTracking): { nombre: string; params: Params } {
  const params: Params = {
    currency: MONEDA,
    value: valorDe(e),
    items: itemsDe(e).map((i) => ({
      item_id: i.id,
      item_name: i.nombre,
      ...(i.marca ? { item_brand: i.marca } : {}),
      price: redondear(i.precio),
      quantity: i.cantidad,
    })),
  };
  if (e.tipo === "pedido_confirmado") params.transaction_id = e.pedidoId;
  return { nombre: NOMBRES_GA4[e.tipo], params };
}

// --- PostHog -------------------------------------------------------------------

/** `posthog.capture(nombre, props)`: el nombre del dominio, props planas. */
export function aPosthog(e: EventoShop): { nombre: string; props: Params } {
  if (esEventoBusqueda(e)) {
    if (e.tipo === "busqueda_chip_quitado") return { nombre: e.tipo, props: { tipo: e.chip, valor: e.valor } };
    const { tipo, ...props } = e;
    return { nombre: tipo, props };
  }
  const items = itemsDe(e);
  const props: Params = {
    valor: valorDe(e),
    moneda: MONEDA,
    unidades: unidades(items),
    productos: items.map((i) => ({ id: i.id, nombre: i.nombre, marca: i.marca, precio: i.precio, cantidad: i.cantidad })),
  };
  if (e.tipo === "ver_producto") {
    props.producto_id = e.item.id;
    props.marca = e.item.marca;
  }
  if (e.tipo === "pedido_confirmado") {
    props.pedido_id = e.pedidoId;
    if (e.numero !== undefined) props.pedido_numero = e.numero;
  }
  return { nombre: e.tipo, props };
}

/** Ítem de tracking desde un ítem del carrito o un producto de la ficha. */
export function itemDe(p: { id: string; name: string; brand?: string; price: number }, cantidad = 1): ItemTracking {
  return { id: p.id, nombre: p.name, ...(p.brand ? { marca: p.brand } : {}), precio: p.price, cantidad };
}
