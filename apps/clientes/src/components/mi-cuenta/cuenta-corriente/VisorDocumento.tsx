"use client";

import { DocumentViewer } from "@myd-org/ui";
import { urlDocumento, type DocumentoAbierto } from "@/lib/cuenta-corriente/vista-facturas";

/**
 * Visor del PDF dentro de la página (como el portal del CRM), sobre el
 * `DocumentViewer` del DS. El PDF lo sirve la ruta proxy, que valida que el
 * documento sea del cliente; si no, el visor muestra su `{ error }`.
 */
export function VisorDocumento({ doc, onClose }: { doc: DocumentoAbierto | null; onClose: () => void }) {
  return (
    <DocumentViewer
      open={doc !== null}
      onOpenChange={(abierto) => {
        if (!abierto) onClose();
      }}
      title={doc?.titulo ?? ""}
      src={doc ? urlDocumento(doc.kind, doc.alegraId) : ""}
      downloadHref={doc ? urlDocumento(doc.kind, doc.alegraId, true) : ""}
      hint={null}
    />
  );
}
