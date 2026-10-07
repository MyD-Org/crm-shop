import { Alert } from "@myd-org/ui";
import {
  TEXTO_AVISO_EN_REVISION,
  TEXTO_AVISO_FALTA,
  type AvisoComprobante as TipoAviso,
} from "@/lib/comprobantes/aviso-card";
import { hrefPedido } from "@/lib/mi-cuenta-nav";
import { BotonEnlace } from "./BotonEnlace";
import { QUERY_SUBIR_COMPROBANTE } from "./InformarPagoPedido";

/**
 * Aviso del comprobante de transferencia (card y detalle del pedido). "falta" ofrece cargarlo
 * (detalle con el formulario ya abierto); "en revisión" sólo informa. El DS 0.40 no tiene
 * `Alert tone="info"`: se usa `neutral` hasta que exista.
 */
export function AvisoComprobante({
  aviso,
  pedidoId,
  conEnlace = true,
}: {
  aviso: TipoAviso;
  pedidoId: string;
  conEnlace?: boolean;
}) {
  if (aviso === "en_revision") {
    return (
      <Alert tone="neutral">
        <p>{TEXTO_AVISO_EN_REVISION}</p>
      </Alert>
    );
  }
  return (
    <Alert tone="warning">
      <p>{TEXTO_AVISO_FALTA}</p>
      {conEnlace && (
        <div className="mt-3">
          {/* Abre el formulario de una vez (antes llevaba al detalle y había que volver a tocar). */}
          <BotonEnlace size="sm" href={`${hrefPedido(pedidoId)}?${QUERY_SUBIR_COMPROBANTE}#comprobante`}>
            Cargar comprobante
          </BotonEnlace>
        </div>
      )}
    </Alert>
  );
}
