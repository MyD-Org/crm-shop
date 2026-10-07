"use client";

import { useState } from "react";
import { Alert, Button, Card } from "@myd-org/ui";

/**
 * Pagar con la cuenta de Mercado Pago (dinero disponible o tarjetas guardadas). Va fuera del Payment
 * Brick: se lleva al comprador al sitio de Mercado Pago y vuelve a `/checkout?pedido=<id>` al terminar
 * (ver `/api/pagos/mercadopago/preferencia`). El botón dice a dónde va, cosa que el Brick no permite.
 */
export function PagoCuentaMercadoPago({ pedidoId }: { pedidoId: string }) {
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function irAMercadoPago() {
    setYendo(true);
    setError(null);
    try {
      const res = await fetch("/api/pagos/mercadopago/preferencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedidoId }),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error ?? "No pudimos abrir Mercado Pago. Inténtelo de nuevo o pague con tarjeta.");
        setYendo(false);
        return;
      }
      // Sigue "yendo" hasta que el navegador cambie de página.
      window.location.assign(json.url);
    } catch {
      setError("No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.");
      setYendo(false);
    }
  }

  return (
    <Card
      title="Cuenta de Mercado Pago"
      description="Pague con su dinero disponible o con las tarjetas guardadas en su cuenta. Lo llevamos a Mercado Pago para completar el pago y vuelve a esta página."
    >
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      <Button variant="outline" onClick={irAMercadoPago} disabled={yendo}>
        {yendo ? "Abriendo Mercado Pago…" : "Ir a Mercado Pago"}
      </Button>
    </Card>
  );
}
