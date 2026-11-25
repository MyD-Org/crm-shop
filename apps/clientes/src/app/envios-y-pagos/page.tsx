import type { Metadata } from "next";
import { PaginaLegal } from "@/components/legales/PaginaLegal";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";
import { envioPorZonaHabilitado } from "@/lib/envio-zona-flag";
import { getDatosLegales } from "@/lib/home-datos";
import { bloquesEnviosYPagos } from "@/lib/legales/envios-y-pagos";
import { mediosOfrecibles } from "@/lib/medios-pago-datos";

export const metadata: Metadata = { title: "Envíos y pagos" };

/** Contenido armado desde la configuración de envío del CRM y los medios de pago del CRM y el flag `cuotas`. */
export default async function EnviosYPagosPage() {
  const [datos, reglas, medios, cuotas] = await Promise.all([
    getDatosLegales(),
    // Flag `envio-por-zona`: prendido, la config trae los métodos por zona para describirlos.
    envioPorZonaHabilitado().then((envioZona) => reglasVentaCacheadas(envioZona)),
    mediosOfrecibles(),
    cuotasHabilitadas(),
  ]);
  return (
    <PaginaLegal
      titulo="Envíos y pagos"
      bloques={bloquesEnviosYPagos({ envio: reglas.envio ?? CONFIG_ENVIO_DEFAULT, medios, cuotas })}
      datos={datos}
    />
  );
}
