import { Alert } from "@myd-org/ui";
import { rutaVincular } from "@/lib/mi-cuenta-nav";
import { BotonEnlace } from "./BotonEnlace";

/**
 * Aviso destacado para quien cargó un documento que ya es de un cliente en
 * Alegra (`billing_profiles.coincide_con_alegra`) pero no vinculó su cuenta.
 *
 * Solo RECOMIENDA: vincular sigue exigiendo el código al email registrado,
 * porque un CUIT lo puede escribir cualquiera. Quien llama decide mostrarlo
 * (coincide y sin cliente vinculado).
 *
 * `volver`: a dónde regresar después de vincular (ej. "/checkout").
 */
export function AvisoVincular({ volver, enCheckout = false }: { volver?: string; enCheckout?: boolean }) {
  return (
    <Alert tone={enCheckout ? "warning" : "success"} title="Parece que ya es cliente de Central LED">
      <p>
        {enCheckout
          ? "Su documento está registrado en Central LED. Vincule su cuenta antes de confirmar para que esta compra quede en su cuenta de cliente."
          : "Su documento está registrado en Central LED. Vincule su cuenta para comprar con sus precios y condiciones de cliente."}
      </p>
      <div className="mt-3">
        <BotonEnlace size="sm" href={rutaVincular(volver)}>
          Vincular mi cuenta
        </BotonEnlace>
      </div>
    </Alert>
  );
}
