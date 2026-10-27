/**
 * Venta sin stock por modalidad (puro, sin servidor ni base): tipos, reglas y textos.
 *
 * La modalidad la crea el CRM (`public.modalidades_sin_stock`) y la asigna por producto
 * (`catalog_overlay.modalidad_sin_stock_id`). El servidor la resuelve; el navegador nunca decide
 * "a pedido", el flujo ni la lista. El `nombre` interno sólo existe en el servidor y en el snapshot
 * del pedido.
 */
import type { Product } from "@/data/products";
import type { DisponibilidadProducto } from "./sucursales-disponibilidad";

export type FlujoVentaSinStock = "en_linea" | "a_confirmar";

/** Lo que ve el navegador (sin el nombre interno). */
export interface VentaSinStock {
  id: string;
  texto: string;
  plazoDias: number | null;
  flujo: FlujoVentaSinStock;
}

/** Sólo servidor. */
export interface ModalidadSinStock extends VentaSinStock {
  nombre: string;
}

/** Lo que se congela en la línea del pedido (`order_items.venta_sin_stock`). */
export interface SnapshotVentaSinStock {
  modalidadId: string;
  nombre: string;
  texto: string;
  plazoDias: number | null;
  flujo: FlujoVentaSinStock;
}

export type FlujoPedido = "normal" | "a_confirmar";

export const TEXTO_SE_CONFIRMA_POR_CONTACTO = "Se confirma por contacto; no se cobra al comprar";
export const TEXTO_CARRITO_A_CONFIRMAR =
  "Su pedido incluye productos que se confirman por contacto: no se cobra al comprar.";
export const TEXTO_PEDIDO_A_CONFIRMAR =
  "Su pedido quedó a confirmar; no se realizó ningún cobro. Nos comunicaremos con usted para confirmarlo.";

type ConStock = Pick<Product, "stock" | "ventaSinStock">;

export function esAPedido(p: ConStock): boolean {
  return p.stock === "out" && !!p.ventaSinStock;
}

export function agotadoSinModalidad(p: ConStock): boolean {
  return p.stock === "out" && !p.ventaSinStock;
}

export function aVentaSinStock(m: ModalidadSinStock): VentaSinStock {
  return { id: m.id, texto: m.texto, plazoDias: m.plazoDias, flujo: m.flujo };
}

export function modalidadPorId(
  modalidades: readonly VentaSinStock[],
  id: string | null | undefined,
): VentaSinStock | undefined {
  if (!id) return undefined;
  return modalidades.find((m) => m.id === id);
}

/** Con modalidad y stock conocido menor a la cantidad, la línea entera pasa a pedido. */
export function lineaAPedido(a: {
  stockDisponible: number | null;
  qty: number;
  modalidad?: VentaSinStock;
}): boolean {
  return !!a.modalidad && a.stockDisponible !== null && a.stockDisponible < a.qty;
}

export function flujoDelPedido(
  lineas: readonly { ventaSinStock?: Pick<VentaSinStock, "flujo"> }[],
): FlujoPedido {
  return lineas.some((l) => l.ventaSinStock?.flujo === "a_confirmar") ? "a_confirmar" : "normal";
}

export function snapshotLinea(m: ModalidadSinStock): SnapshotVentaSinStock {
  return { modalidadId: m.id, nombre: m.nombre, texto: m.texto, plazoDias: m.plazoDias, flujo: m.flujo };
}

/** Defensivo: un jsonb de una fila vieja o rota da null. */
export function leerSnapshot(v: unknown): SnapshotVentaSinStock | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.modalidadId !== "string" || typeof o.nombre !== "string" || typeof o.texto !== "string") return null;
  if (o.flujo !== "en_linea" && o.flujo !== "a_confirmar") return null;
  if (o.plazoDias !== null && typeof o.plazoDias !== "number") return null;
  return { modalidadId: o.modalidadId, nombre: o.nombre, texto: o.texto, plazoDias: o.plazoDias, flujo: o.flujo };
}

export function textoPlazoHabil(plazoDias: number | null): string {
  if (plazoDias === null) return "a coordinar";
  return plazoDias === 1 ? "1 día hábil" : `${plazoDias} días hábiles`;
}

export function pedidoAConfirmarPorModalidad(
  pagoMetodo: string,
  items: readonly { ventaSinStock?: SnapshotVentaSinStock | null }[],
): boolean {
  return pagoMetodo === "a_coordinar" && items.some((i) => i.ventaSinStock?.flujo === "a_confirmar");
}

/** La modalidad de alguna línea cambió (o dejó de estar activa) entre la cotización y el pedido. */
export class VentaSinStockCambioError extends Error {
  constructor(readonly ids: string[]) {
    super("La modalidad de venta sin stock cambió");
    this.name = "VentaSinStockCambioError";
  }
}

/**
 * Ids que el motor de disponibilidad dejó "por pedido" para la entrega elegida: envío =
 * `envio.estado`; retiro = el estado en el local (sin local, ninguno). Es lo que decide qué líneas
 * van a pedido al cotizar con el flag `disponibilidad-sucursal`.
 */
export function idsAPedido(
  productos: Record<string, DisponibilidadProducto>,
  entrega: { tipo: "envio" | "retiro"; local: string | null },
): Set<string> {
  const ids = new Set<string>();
  for (const [id, p] of Object.entries(productos)) {
    const estado =
      entrega.tipo === "envio"
        ? p.envio?.estado
        : entrega.local
          ? p.retiro?.[entrega.local]?.estado
          : undefined;
    if (estado === "por_pedido") ids.add(id);
  }
  return ids;
}
