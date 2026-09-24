import { Alert } from "@myd-org/ui";

/**
 * Una sección caída y una vacía no pueden verse igual: sin este aviso, el
 * cliente lee "Todavía no tiene facturas" y cree que se le perdieron. El resto
 * de Mi cuenta sigue andando.
 */
export function AvisoSeccionCaida({
  que,
}: {
  que: "sus facturas" | "su saldo" | "sus pagos" | "sus presupuestos" | "sus avisos" | "sus condiciones comerciales";
}) {
  return (
    <Alert tone="warning">
      No pudimos obtener {que}. Inténtelo de nuevo en unos minutos.
    </Alert>
  );
}
