/**
 * Estado visible único de un pedido (una sola pill). Módulo puro: lo usan la
 * card de pedido y el detalle de Mi cuenta.
 *
 * Proyecta `(estado, pagoEstado, entregaTipo)` a `{ label, tone }`. El tono es
 * el del `Badge` del DS: el Shop no define colores por estado. Precedencia:
 * 1. cancelado            → "Cancelado"       (danger)
 * 2. pago fallido         → "Pago rechazado"  (danger)
 * 3. pendiente + pendiente → "Pago pendiente" (warning), o "Pago en proceso" (info) con el cobro ya
 *    enviado al procesador
 * 4. pendiente + pagado   → "Pago confirmado" (info)
 * 5. confirmado / preparacion / en_camino → su nombre (info)
 * 6. entregado            → "Retirado" o "Entregado" según la entrega (success)
 *
 * Si el pedido no se cobra en línea (su `pagoMetodoSlug` no es `mercadopago`) el
 * paso 3 dice "Pendiente" en neutro: "Pago pendiente" sólo confunde (misma regla
 * que pago-estado-visible.ts).
 */
import type { BadgeTone } from "@myd-org/ui";
import type { Order } from "@/data/orders";
import { ocultarEstadoPago } from "./pago-estado-visible";

export interface PillEstado {
  label: string;
  tone: BadgeTone;
}

const EN_CURSO: Record<"confirmado" | "preparacion" | "en_camino", string> = {
  confirmado: "Confirmado",
  preparacion: "En preparación",
  en_camino: "En camino",
};

export function estadoPedidoPill(
  o: Pick<Order, "estado" | "pagoEstado" | "entregaTipo" | "pagoMetodoSlug" | "pagoEnProceso">,
): PillEstado {
  if (o.estado === "cancelado") return { label: "Cancelado", tone: "danger" };
  if (o.pagoEstado === "fallido") return { label: "Pago rechazado", tone: "danger" };
  if (o.estado === "pendiente") {
    if (ocultarEstadoPago(o.pagoEstado, o.pagoMetodoSlug)) {
      return { label: "Pendiente", tone: "neutral" };
    }
    if (o.pagoEstado === "pagado") return { label: "Pago confirmado", tone: "info" };
    // El cobro ya está en manos del procesador: no es "falta pagar", es "se está confirmando".
    return o.pagoEnProceso
      ? { label: "Pago en proceso", tone: "info" }
      : { label: "Pago pendiente", tone: "warning" };
  }
  if (o.estado === "entregado") {
    return {
      label: o.entregaTipo === "retiro" ? "Retirado" : "Entregado",
      tone: "success",
    };
  }
  return { label: EN_CURSO[o.estado], tone: "info" };
}
