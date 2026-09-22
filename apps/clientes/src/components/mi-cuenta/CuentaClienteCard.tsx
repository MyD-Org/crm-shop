import { Badge, Card } from "@myd-org/ui";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";
import { BotonEnlace } from "./BotonEnlace";

/**
 * Estado de la vinculación con la cuenta de cliente de Alegra.
 *
 * "Cuenta de cliente" y no "cuenta corriente" a propósito: en Alegra también
 * hay clientes de CONTADO, con historial, facturas y su lista de precios.
 *
 * Con el documento ya registrado en Alegra NO se vincula solo (sería regalarle
 * la cuenta a quien escriba un CUIT ajeno): se invita, y la prueba sigue
 * siendo el código al email registrado.
 */
export function CuentaClienteCard({
  razonSocialVinculada,
  cuit,
  coincideConAlegra,
}: {
  razonSocialVinculada?: string;
  cuit?: string;
  coincideConAlegra?: boolean;
}) {
  if (razonSocialVinculada) {
    return (
      <Card title="Su cuenta de cliente" action={<Badge tone="success">Vinculada</Badge>}>
        <p className="text-sm text-muted">
          Su usuario está vinculado a <span className="font-medium text-text">{razonSocialVinculada}</span>
          {cuit ? ` (CUIT ${cuit})` : ""}. Está viendo su lista de precios.
        </p>
      </Card>
    );
  }

  return (
    <Card title="¿Ya es cliente del local?">
      <p className="text-sm text-muted">
        {coincideConAlegra
          ? "Encontramos una cuenta con ese documento en nuestro sistema. Vincúlela para ver sus precios y todas sus facturas."
          : "Está comprando a precio de lista general. Si ya compra en el local, vincule su cuenta para ver sus precios, sus facturas y —si tiene cuenta corriente— su saldo."}
      </p>
      <div className="mt-4">
        <BotonEnlace href={RUTAS_MI_CUENTA.vincular}>Ya soy cliente del local</BotonEnlace>
      </div>
    </Card>
  );
}
