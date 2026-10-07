import { Alert, Button } from "@myd-org/ui";

/** Avisos del formulario de pago de Mercado Pago, con el `Alert` del DS. */

export function AvisoFormularioNoCargo({ onReintentar }: { onReintentar: () => void }) {
  return (
    <Alert tone="danger" title="No se pudo cargar el formulario de pago" className="mb-4">
      <p>Revise su conexión e inténtelo de nuevo.</p>
      <Button variant="secondary" className="mt-3" onClick={onReintentar}>
        Reintentar
      </Button>
    </Alert>
  );
}

export function AvisoPagoRechazado({
  mensaje,
  reintentable,
  onReintentar,
}: {
  mensaje: string;
  reintentable: boolean;
  onReintentar: () => void;
}) {
  return (
    <Alert tone="danger" title="No se pudo completar el pago" className="mb-4">
      <p>{mensaje}</p>
      {reintentable && (
        <Button variant="secondary" className="mt-3" onClick={onReintentar}>
          Probar de nuevo
        </Button>
      )}
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
