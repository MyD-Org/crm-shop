"use client";

import { useRouter } from "next/navigation";
import type { ComprobanteCliente } from "@/lib/comprobantes/repo";
import { InformarPago } from "./InformarPago";

/**
 * Encabezado de Mi cuenta → Pagos: "Informar pago". Los informados en revisión
 * se ven en la misma tabla de pagos; al informar uno se refresca la página para
 * que aparezca ahí. Sólo se monta con el almacenamiento de comprobantes
 * configurado (CMP-5).
 */
export function ComprobantesPagos({ ultimos }: { ultimos: ComprobanteCliente[] }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">¿Hizo un pago? Infórmelo con su comprobante y lo registraremos.</p>
      <InformarPago ultimos={ultimos} onInformado={() => router.refresh()} />
    </div>
  );
}
