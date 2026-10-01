import type { Metadata } from "next";
import { PaginaLegal } from "@/components/legales/PaginaLegal";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";
import { getDatosLegales } from "@/lib/home-datos";
import { bloquesEnviosYPagos } from "@/lib/legales/envios-y-pagos";
import { pagosHabilitados } from "@/lib/pagos-flag";

export const metadata: Metadata = { title: "Envíos y pagos" };

/** Contenido armado desde la configuración de envío del CRM y los flags `pagos` y `cuotas`. */
export default async function EnviosYPagosPage() {
  const [datos, reglas, pagos, cuotas] = await Promise.all([
    getDatosLegales(),
    reglasVentaCacheadas(),
    pagosHabilitados(),
    cuotasHabilitadas(),
  ]);
  return (
    <PaginaLegal
      titulo="Envíos y pagos"
      bloques={bloquesEnviosYPagos({ envio: reglas.envio ?? CONFIG_ENVIO_DEFAULT, pagos, cuotas })}
      datos={datos}
    />
  );
}
