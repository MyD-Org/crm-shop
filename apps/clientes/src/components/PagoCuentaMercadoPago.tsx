"use client";

import { useEffect, useState } from "react";
import { Alert, Button } from "@myd-org/ui";
import { IconoSalida } from "./PagoIconos";

/**
 * Pagar con la cuenta de Mercado Pago (dinero disponible o tarjetas guardadas): el contenido de esa
 * opción en "¿Cómo quiere pagar?". Se lleva al comprador al sitio de Mercado Pago y vuelve a
 * `/checkout?pedido=<id>` al terminar (ver `/api/pagos/mercadopago/preferencia`). El botón dice a dónde
 * va, cosa que el Brick no permite.
 */
export function PagoCuentaMercadoPago({ pedidoId, cuotas }: { pedidoId: string; cuotas?: number }) {
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Volver con "atrás" desde Mercado Pago restaura la página de la memoria del navegador (bfcache) con
  // el botón todavía en "Abriendo Mercado Pago…": se lo devuelve a su estado.
  useEffect(() => {
    const alVolver = (e: PageTransitionEvent) => {
      if (e.persisted) setYendo(false);
    };
    window.addEventListener("pageshow", alVolver);
    return () => window.removeEventListener("pageshow", alVolver);
  }, []);

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
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 text-sm text-muted">
        <IconoSalida />
        <span>
          Lo llevamos a Mercado Pago para completar el pago. Al terminar, vuelve a esta página con su pedido.
          {cuotas !== undefined && cuotas > 1 && ` Allá puede elegir hasta ${cuotas} cuotas.`}
        </span>
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button onClick={irAMercadoPago} loading={yendo} disabled={yendo}>
        {yendo ? "Abriendo Mercado Pago…" : "Ir a Mercado Pago"}
      </Button>
    </div>
  );
}
