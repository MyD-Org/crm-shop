import { Alert, Button } from "@myd-org/ui";

/** Avisos del formulario de pago de Mercado Pago, con el `Alert` del DS. */

export function AvisoFormularioNoCargo({ onReintentar }: { onReintentar: () => void }) {
  return (
    <Alert tone="danger" title="No se pudo cargar el formulario de pago">
      <p>Revise su conexión e inténtelo de nuevo.</p>
      <Button variant="secondary" className="mt-3" onClick={onReintentar}>
        Reintentar
      </Button>
    </Alert>
  );
}

/**
 * Rechazo del pago: sólo el motivo, sin botón. El formulario de abajo ya quedó listo para otro intento
 * (se remonta al rechazar: el token de Mercado Pago es de un solo uso).
 */
export function AvisoPagoRechazado({ mensaje }: { mensaje: string }) {
  return (
    <Alert tone="danger" title="No se pudo completar el pago">
      <p>{mensaje}</p>
    </Alert>
  );
}

export function AvisoSinConfigurar() {
  return (
    <Alert tone="danger">
      El pago con Mercado Pago no está configurado. Elija transferencia o escríbanos.
    </Alert>
  );
}
