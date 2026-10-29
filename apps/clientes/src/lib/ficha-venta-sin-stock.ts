/** Lo que decide la ficha del producto según su stock y su modalidad de venta sin stock (puro). */
import type { Product } from "@/data/products";
import { esAPedido } from "./venta-sin-stock";

export type TonoFicha = "ok" | "demora" | "no";

export interface EstadoFicha {
  texto: string;
  tono: TonoFicha;
  agotado: boolean;
  /** Flujo "a confirmar": no se cobra al comprar, así que no hay cuotas ni medios de pago. */
  aConfirmar: boolean;
}

const ESTADO_STOCK: Record<Product["stock"], { texto: string; tono: TonoFicha }> = {
  in: { texto: "En stock", tono: "ok" },
  low: { texto: "Últimas unidades", tono: "demora" },
  out: { texto: "Sin stock", tono: "no" },
};

export function estadoFicha(p: Pick<Product, "stock" | "ventaSinStock">): EstadoFicha {
  if (esAPedido(p)) {
    return { texto: p.ventaSinStock!.texto, tono: "demora", agotado: false, aConfirmar: p.ventaSinStock!.flujo === "a_confirmar" };
  }
  return { ...ESTADO_STOCK[p.stock], agotado: p.stock === "out", aConfirmar: false };
}
