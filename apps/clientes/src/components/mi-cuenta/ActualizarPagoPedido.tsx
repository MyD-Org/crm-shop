"use client";

import { useRouter } from "next/navigation";
import { useSondeoPago } from "@/components/useSondeoPago";

/**
 * No dibuja nada: mientras el pago en línea de un pedido sigue pendiente, consulta su estado (la misma
 * consulta del checkout, `GET /api/pedidos/[id]/pago`, que le pregunta al procesador y registra el
 * resultado) y, apenas se resuelve, recarga la página para mostrar "Pago aprobado" o "Pago rechazado".
 * Se monta sólo con el pago pendiente de un pedido que se cobra en línea.
 */
export function ActualizarPagoPedido({ pedidoId }: { pedidoId: string }) {
  const router = useRouter();
  useSondeoPago(pedidoId, () => router.refresh(), { inmediato: true });
  return null;
}
