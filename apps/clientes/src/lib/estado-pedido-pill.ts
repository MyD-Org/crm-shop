/**
 * Estado visible único de un pedido (una sola pill). Módulo puro: lo usan la
 * card de pedido y el detalle de Mi cuenta.
 *
 * Proyecta `(estado, pagoEstado, entregaTipo)` a `{ label, tone }`. El tono es
 * el del `Badge` del DS: el Shop no define colores por estado. Precedencia:
 * 1. cancelado            → "Cancelado"       (danger)
 * 2. pago fallido         → "Pago rechazado"  (danger)
 * 3. pendiente + pendiente → "Pago pendiente" (warning)
 * 4. pendiente + pagado   → "Pago confirmado" (info)
 * 5. confirmado / preparacion / en_camino → su nombre (info)
 * 6. entregado            → "Retirado" o "Entregado" según la entrega (success)
 */
import type { BadgeTone } from "@myd-org/ui";
import type { Order } from "@/data/orders";

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
  o: Pick<Order, "estado" | "pagoEstado" | "entregaTipo">,
): PillEstado {
  if (o.estado === "cancelado") return { label: "Cancelado", tone: "danger" };
  if (o.pagoEstado === "fallido") return { label: "Pago rechazado", tone: "danger" };
  if (o.estado === "pendiente") {
    return o.pagoEstado === "pagado"
      ? { label: "Pago confirmado", tone: "info" }
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
