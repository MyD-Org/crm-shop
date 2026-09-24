import { Badge, Card } from "@myd-org/ui";
import { documentoEnLinea } from "@/lib/facturacion";

/**
 * Cuenta de cliente vinculada (Mis datos, estado `vinculado`).
 *
 * "Cuenta de cliente" y no "cuenta corriente" a propósito: en Alegra también
 * hay clientes de CONTADO, con historial y facturas.
 *
 * Sin vincular no se usa esta card: Mis datos pregunta si ya es cliente
 * (`PreguntaCliente`), muestra `AvisoVincular` o un enlace discreto
 * (`SugerirVincular`), según `estadoMisDatos`.
 */
export function CuentaClienteCard({ razonSocialVinculada, cuit }: { razonSocialVinculada: string; cuit?: string }) {
  return (
    <Card title="Su cuenta de cliente" action={<Badge tone="success">Vinculada</Badge>}>
      <p className="text-sm text-muted">
        Su usuario está vinculado a <span className="font-medium text-text">{razonSocialVinculada}</span>
        {cuit ? ` (${documentoEnLinea(cuit)})` : ""}.
      </p>
    </Card>
  );
}
