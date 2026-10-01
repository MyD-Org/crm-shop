import { CarritoClient } from "@/components/CarritoClient";
import { getOfertaCuotasSinCache } from "@/lib/cuotas-datos";
import { identidadActual } from "@/lib/auth";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";

export default async function CarritoPage() {
  const [oferta, { clerkUserId, cliente }, reglas] = await Promise.all([
    getOfertaCuotasSinCache(),
    identidadActual(),
    reglasVentaCacheadas(),
  ]);
  return (
    <CarritoClient
      oferta={oferta}
      conSesion={!!(clerkUserId || cliente)}
      configEnvio={reglas.envio ?? CONFIG_ENVIO_DEFAULT}
      // Dirección guardada → ubicación elegida (cookie) → sin ubicación (la barra de envío gratis
      // no aparece si el alcance depende de la provincia). Si la lectura falla, sin ubicación.
      provincia={(await ubicacionDelVisitante().catch(() => null))?.ubicacion?.provincia ?? null}
    />
  );
}
