import { CarritoClient } from "@/components/CarritoClient";
import { getOfertaCuotasSinCache } from "@/lib/cuotas-datos";
import { identidadActual } from "@/lib/auth";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { entregaDelCarrito } from "@/lib/entrega-eleccion";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";

export default async function CarritoPage() {
  const [oferta, { clerkUserId, cliente }, reglas] = await Promise.all([
    getOfertaCuotasSinCache(),
    identidadActual(),
    reglasVentaCacheadas(),
  ]);
  // Elección única: retiro => cotiza como retiro, sin provincia (sin envío ni barra de envío gratis);
  // envío => cotiza a la provincia elegida; sin elección o si la lectura falla => como siempre.
  const eleccion = (await ubicacionDelVisitante().catch(() => null))?.eleccion ?? { tipo: "ninguna" as const };
  const { entregaTipo, provincia, ubicacionConocida } = entregaDelCarrito(eleccion);
  return (
    <CarritoClient
      oferta={oferta}
      conSesion={!!(clerkUserId || cliente)}
      configEnvio={reglas.envio ?? CONFIG_ENVIO_DEFAULT}
      entregaTipo={entregaTipo}
      provincia={provincia}
      ubicacionConocida={ubicacionConocida}
    />
  );
}
