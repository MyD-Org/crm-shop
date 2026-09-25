import type { Metadata } from "next";
import { PaginaLegal } from "@/components/legales/PaginaLegal";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { envioHabilitado } from "@/lib/envio-flag";
import { getDatosLegales } from "@/lib/home-datos";
import { bloquesEnviosYPagos } from "@/lib/legales/envios-y-pagos";
import { pagosHabilitados } from "@/lib/pagos-flag";

export const metadata: Metadata = { title: "Envíos y pagos" };

/** Contenido armado desde lib/envio.ts y los flags `envio`, `pagos` y `cuotas`. */
export default async function EnviosYPagosPage() {
  const [datos, envio, pagos, cuotas] = await Promise.all([
    getDatosLegales(),
    envioHabilitado(),
    pagosHabilitados(),
    cuotasHabilitadas(),
  ]);
  return (
    <PaginaLegal
      titulo="Envíos y pagos"
      bloques={bloquesEnviosYPagos({ envio, pagos, cuotas })}
      datos={datos}
    />
  );
}
