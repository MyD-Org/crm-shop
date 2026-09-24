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
    <Alert tone={enCheckout ? "warning" : "success"} title="Parece que ya es cliente del local">
      <p>
        {enCheckout
          ? "Su documento está registrado en el local. Vincule su cuenta antes de confirmar para comprar con sus precios."
          : "Su documento está registrado en el local. Vincule su cuenta para ver sus facturas y sus compras."}
      </p>
      <div className="mt-3">
        <BotonEnlace size="sm" href={rutaVincular(volver)}>
          Vincular mi cuenta
        </BotonEnlace>
      </div>
    </Alert>
  );
}
