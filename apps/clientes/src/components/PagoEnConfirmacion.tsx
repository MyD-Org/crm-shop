"use client";

import Link from "next/link";
import { Button } from "@myd-org/ui";
import { hrefPedido } from "@/lib/mi-cuenta-nav";
import { useSondeoPago } from "./useSondeoPago";

/**
 * "Estamos confirmando su pago": el procesador tardó en responder y el pedido quedó pendiente.
 *
 * Mientras está en pantalla consulta el estado del pago (`GET /api/pedidos/[id]/pago`, que le pregunta
 * al procesador) cada pocos segundos durante unos minutos y avisa a quien lo usa apenas se resuelve:
 * `onPagado` o `onRechazado` (con el mensaje ya traducido y si el pedido se puede volver a pagar). Si
 * se agota la espera no inventa un resultado: indica que llegará por correo y dónde verlo.
 */
export function PagoEnConfirmacion({
  pedidoId,
  onPagado,
  onRechazado,
}: {
  pedidoId: string;
  onPagado: () => void;
  onRechazado: (mensaje: string, cobrable: boolean) => void;
}) {
  const { agotado, reiniciar } = useSondeoPago(pedidoId, (r) => {
    if (r.fase === "pagado") onPagado();
    else onRechazado(r.mensaje, r.cobrable);
  });

  if (agotado) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-bold text-text">Su pago todavía se está confirmando</p>
        <p className="mt-1 text-sm text-muted">
          Le enviaremos un correo con el resultado. También puede verlo en{" "}
          <Link href={hrefPedido(pedidoId)} className="underline">
            Mi cuenta → Pedidos
          </Link>
          . No hace falta que pague de nuevo.
        </p>
        <Button variant="secondary" className="mt-3" onClick={reiniciar}>
          Consultar ahora
        </Button>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-border bg-surface p-5">
      <p className="text-sm font-bold text-text">Estamos confirmando su pago</p>
      <p className="mt-1 text-sm text-muted">
        El procesador todavía lo está confirmando. Esta pantalla se actualiza sola apenas haya un resultado; no hace falta
        que pague de nuevo.
      </p>
    </div>
  );
}
