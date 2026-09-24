"use client";

import { Alert } from "@myd-org/ui";
import type { ComprobanteCliente } from "@/lib/comprobantes/repo";
import { HISTORIAL_CAIDO } from "@/lib/comprobantes/mensajes";
import { SeccionTitulo } from "../SeccionTitulo";
import { InformarPago } from "./InformarPago";
import { MisComprobantes } from "./MisComprobantes";
import { usePaginaApi } from "./usePaginaApi";

/**
 * Bloque de comprobantes de Mi cuenta → Pagos: el botón "Informar pago" y,
 * si ya informó alguno, "Mis comprobantes" con "Cargar más". Sólo se monta con
 * el almacenamiento de comprobantes configurado (CMP-5).
 */
export function ComprobantesPagos({
  primeraPagina,
}: {
  /** `null` = no se pudo leer el historial: el botón se ofrece igual. */
  primeraPagina: { comprobantes: ComprobanteCliente[]; total: number } | null;
}) {
  const pagina = usePaginaApi<ComprobanteCliente>({
    ruta: "/api/mi-cuenta/comprobantes",
    campo: "comprobantes",
    inicial: { items: primeraPagina?.comprobantes ?? [], total: primeraPagina?.total ?? 0 },
    errorCarga: HISTORIAL_CAIDO,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">¿Hizo un pago? Infórmelo con su comprobante y lo registraremos.</p>
        <InformarPago ultimos={pagina.items} onInformado={pagina.recargar} />
      </div>

      {primeraPagina === null && pagina.items.length === 0 ? (
        <Alert tone="warning">{HISTORIAL_CAIDO}</Alert>
      ) : (
        (pagina.total > 0 || pagina.error) && (
          <section aria-labelledby="mis-comprobantes">
            <SeccionTitulo id="mis-comprobantes" titulo="Mis comprobantes" />
            <MisComprobantes
              items={pagina.items}
              total={pagina.total}
              cargando={pagina.cargando}
              error={pagina.error}
              onCargarMas={pagina.cargarMas}
            />
          </section>
        )
      )}
    </div>
  );
}
