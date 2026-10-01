"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Dialog, useToast } from "@myd-org/ui";

/**
 * Cancelar un pedido pendiente desde Mi cuenta, con confirmación. El servidor
 * decide: si el pedido ya se pagó, se facturó o tiene un pago en curso, la
 * respuesta lo explica y se muestra acá.
 */
export function CancelarPedido({ pedidoId, numero }: { pedidoId: string; numero: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [abierto, setAbierto] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setCancelando(true);
    setError(null);
    try {
      const res = await fetch(`/api/pedidos/${pedidoId}/cancelar`, { method: "POST" });
      if (res.ok) {
        setAbierto(false);
        toast({ title: `Pedido ${numero} cancelado`, tone: "success" });
        router.refresh();
        return;
      }
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(
        res.status === 409 && json?.error
          ? json.error
          : "No se pudo cancelar el pedido. Inténtelo de nuevo en un momento.",
      );
    } catch {
      setError("No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.");
    } finally {
      setCancelando(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setError(null);
          setAbierto(true);
        }}
      >
        Cancelar pedido
      </Button>
      <Dialog
        open={abierto}
        onOpenChange={(o) => {
          if (!cancelando) setAbierto(o);
        }}
        title="¿Desea cancelar este pedido?"
        description={`Se cancelará el pedido ${numero} y se liberarán los productos reservados. Esta acción no se puede deshacer.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAbierto(false)} disabled={cancelando}>
              Volver
            </Button>
            <Button variant="danger" loading={cancelando} onClick={confirmar}>
              Cancelar pedido
            </Button>
          </>
        }
      >
        {error && <Alert tone="danger">{error}</Alert>}
      </Dialog>
    </>
  );
}
