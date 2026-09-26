import { Badge, Card } from "@myd-org/ui";
import { documentoEnLinea } from "@/lib/facturacion";

/**
 * Cuenta de cliente vinculada (Mis datos, estado `vinculado`).
 *
 * "Cuenta de cliente" y no "cuenta corriente" a propósito: en Alegra también
 * hay clientes de CONTADO, con historial y facturas.
 *
 * Sin vincular no se muestra nada en su lugar: al cliente de la tienda no se
 * le ofrece vincular.
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
