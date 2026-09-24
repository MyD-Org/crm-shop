"use client";

import type { ReactNode } from "react";
import { Button, Dialog } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import type { Pago } from "@/lib/cuenta-corriente/tipos";
import { urlDocumento } from "@/lib/cuenta-corriente/vista-facturas";
import { IconoDescarga, IconoOjo } from "../iconos";

function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-text">{children}</dd>
    </div>
  );
}

/**
 * Detalle de un pago (PAG-2): datos del recibo y las facturas a las que se
 * imputó, con el monto de cada una. Sólo lo que trae el pago, como el portal
 * (`PagoModal` de apps/admin/src/components/portal/DashboardClient.tsx): no se
 * cruza con las facturas cargadas. El PDF se ve en el visor de la página o se
 * descarga.
 */
export function PagoDetalle({
  pago,
  onClose,
  onVerPdf,
}: {
  pago: Pago | null;
  onClose: () => void;
  onVerPdf: (pago: Pago) => void;
}) {
  return (
    <Dialog
      open={pago !== null}
      onOpenChange={(abierto) => {
        if (!abierto) onClose();
      }}
      title={pago ? `Recibo ${pago.id}` : ""}
      size="md"
      footer={
        pago && (
          <>
            <Button variant="outline" href={urlDocumento("pago", pago.alegraId, true)}>
              <IconoDescarga /> Descargar recibo
            </Button>
            <Button onClick={() => onVerPdf(pago)}>
              <IconoOjo /> Ver recibo
            </Button>
          </>
        )
      }
    >
      {pago && (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-4">
            <Dato label="N° de recibo">{pago.id}</Dato>
            <Dato label="Fecha">{pago.fecha}</Dato>
            <Dato label="Medio de pago">{pago.medio || "—"}</Dato>
            <Dato label="Monto pagado">
              <span className="font-medium tabular-nums">{fmtPrecio(pago.monto)}</span>
            </Dato>
          </dl>

          <section aria-labelledby="imputaciones-titulo" className="flex flex-col gap-2">
            <p id="imputaciones-titulo" className="text-xs font-medium text-muted">
              Facturas canceladas con este pago
            </p>
            {pago.facturas.length === 0 ? (
              <p className="text-sm text-muted">El pago no tiene facturas imputadas.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border border-y border-border">
                {pago.facturas.map((imp, i) => (
                  <li key={`${imp.factura}-${i}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-medium text-text">{imp.factura}</span>
                    <span className="tabular-nums text-text">{fmtPrecio(imp.imputado)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
